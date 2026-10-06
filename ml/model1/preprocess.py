"""
Model 1 preprocessing for ATDE v1.0.0.

Converts raw network-log rows into the same feature representation
used during Isolation Forest training.

Expected input columns:
    stream_name
    timestamp
    event_id
    message_sanitized

Supported streams:
    aws_vpc_flow_log
    cisco_asa
"""

from pathlib import Path
import sys

import numpy as np
import pandas as pd



# ---------------------------------------------------------------------
# Make the project's src modules available.
# ---------------------------------------------------------------------

ROOT = Path(__file__).resolve().parents[4]
SRC = ROOT / "src"

if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

from src import features as _features



# ---------------------------------------------------------------------
# Required raw columns
# ---------------------------------------------------------------------

REQUIRED_COLUMNS = [
    "stream_name",
    "timestamp",
    "event_id",
    "message_sanitized",
]


# ---------------------------------------------------------------------
# Isolation Forest feature construction
# ---------------------------------------------------------------------

DROP_COLUMNS = [
    "src_port",
    "dst_port",
    "protocol",
    "proto",
    "src_zone",
    "dst_zone",
    "acl",
]

AWS_DROP_COLUMNS = [
    "cnt_3600s",
    "nports_3600s",
    "ndst_3600s",
]


def _build_if_matrix(stream, X, raw):
    """
    Convert the training feature matrix into the exact
    Isolation Forest representation used by Model 1.
    """

    M = X.copy()

    # -------------------------------------------------------------
    # Direction
    # -------------------------------------------------------------

    # parse_messages.py in the training pipeline derives direction
    # from the raw network message.
    import parse_messages as pm

    parsed = pm.parse_aws(
        raw.loc[M.index, "message_sanitized"]
    ) if stream == "aws_vpc_flow_log" else pm.parse_cisco(
        raw.loc[M.index, "message_sanitized"]
    )

    # Direction is derived from private/public addressing.
    def is_private(ip):
        if pd.isna(ip):
            return False

        value = str(ip)

        try:
            import ipaddress
            return ipaddress.ip_address(value).is_private
        except ValueError:
            return False

    src_private = parsed["m_src_ip"].map(is_private)
    dst_private = parsed["m_dst_ip"].map(is_private)

    direction = np.select(
        [
            (~src_private) & dst_private,
            src_private & (~dst_private),
            src_private & dst_private,
        ],
        [
            "inbound",
            "outbound",
            "internal",
        ],
        default="external",
    )

    M["dir_inbound"] = (
        direction == "inbound"
    ).astype("int8")

    M["dir_outbound"] = (
        direction == "outbound"
    ).astype("int8")

    # -------------------------------------------------------------
    # Protocol one-hot features
    # -------------------------------------------------------------

    if stream == "aws_vpc_flow_log":
        proto = M["protocol"].map(
            {
                1: "icmp",
                6: "tcp",
                17: "udp",
            }
        )
    else:
        proto = M["proto"].astype(str).str.lower()

    for p in ["tcp", "udp", "icmp"]:
        M[f"proto_{p}"] = (
            proto == p
        ).astype("int8")

    # -------------------------------------------------------------
    # Destination-port frequency
    # -------------------------------------------------------------

    # IMPORTANT:
    # The training notebook fitted this frequency on training
    # residual rows only. For live preprocessing we cannot use
    # future rows, so this value is computed from the supplied
    # historical/batch context.
    freq = M["dst_port"].value_counts()

    M["dst_port_logfreq"] = (
        np.log1p(
            M["dst_port"].map(freq)
        ).fillna(0.0)
    )

    # -------------------------------------------------------------
    # Remove fields not used by the Isolation Forest
    # -------------------------------------------------------------

    M = M.drop(
        columns=DROP_COLUMNS,
        errors="ignore",
    )

    if stream == "aws_vpc_flow_log":
        M = M.drop(
            columns=AWS_DROP_COLUMNS,
            errors="ignore",
        )

    # Same fill behavior used in training.
    M = M.fillna(-1)

    return M


# ---------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------

def build_features(rows):
    """
    Build Model 1 Isolation Forest features.

    Parameters
    ----------
    rows:
        pandas.DataFrame or list of dictionaries containing:
            stream_name
            timestamp
            event_id
            message_sanitized

    Returns
    -------
    dict[str, pandas.DataFrame]
        One feature matrix per stream.

    Example
    -------
    features = build_features(rows)

    aws_features = features["aws_vpc_flow_log"]
    cisco_features = features["cisco_asa"]
    """

    if isinstance(rows, list):
        rows = pd.DataFrame(rows)

    if not isinstance(rows, pd.DataFrame):
        raise TypeError(
            "rows must be a pandas DataFrame "
            "or list of dictionaries"
        )

    missing = [
        c for c in REQUIRED_COLUMNS
        if c not in rows.columns
    ]

    if missing:
        raise ValueError(
            f"Missing required columns: {missing}"
        )

    d = rows.copy()

    # -------------------------------------------------------------
    # Normalize timestamps
    # -------------------------------------------------------------

    d["timestamp"] = pd.to_datetime(
        d["timestamp"],
        utc=True,
        errors="coerce",
    )

    if d["timestamp"].isna().any():
        raise ValueError(
            "Invalid timestamp found in input rows"
        )

    # -------------------------------------------------------------
    # Ensure deterministic event ordering
    # -------------------------------------------------------------

    if "event_id" not in d.columns:
        d["event_id"] = np.arange(len(d))

    d = d.sort_values(
        ["timestamp", "event_id"]
    )

    # -------------------------------------------------------------
    # Use the SAME feature builder used during training.
    # -------------------------------------------------------------

    feature_sets = _features.build_features(
        d,
        CONFIG,
    )

    result = {}

    for stream, X in feature_sets.items():

        M = _build_if_matrix(
            stream,
            X,
            d,
        )

        result[stream] = M

    return result


# ---------------------------------------------------------------------
# Convenience helper
# ---------------------------------------------------------------------

def build_features_single_stream(rows, stream):
    """
    Convenience function when the caller knows the stream.

    Returns one DataFrame instead of a dictionary.
    """

    result = build_features(rows)

    if stream not in result:
        raise ValueError(
            f"No rows found for stream: {stream}"
        )

    return result[stream]