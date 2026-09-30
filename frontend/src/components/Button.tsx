import type { ButtonHTMLAttributes } from "react";
import styles from "./Button.module.css";

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** approve = solid green, reject = outline, primary = solid rust. One primary colour per card. */
  variant: "approve" | "reject" | "primary";
}

/** Buttons say what happens: "APPROVE FIX", "REJECT". No arrows, no icons for decoration. */
export function Button({ variant, className, type = "button", ...rest }: Props) {
  return <button type={type} className={`${styles.btn} ${styles[variant]} ${className ?? ""}`} {...rest} />;
}
