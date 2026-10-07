# Deployment: one Azure VM (FINAL_PLAN.md section 5)

The whole Docker stack runs on one VM, with Caddy in front as the only public web address.

| | |
|---|---|
| VM | `netra-vm`, resource group `netra-rg`, Central India, `Standard_D4as_v4` (4 vCPU, 16 GB), Ubuntu 24.04 |
| Address | `20.244.8.57`, dashboard at **https://20-244-8-57.sslip.io** |
| Sign in (SSH) | `ssh netra` (`~/.ssh/config`: user `azureuser`, key `netra-vm_key.pem`) |
| Code | `~/netra` on the VM, a clone of `main`; secrets in `~/netra/.env` (not in git) |

## What runs where, and what is exposed
```
phone / laptop ──HTTPS 443──► Caddy (web) ─┬─ /api/*  ─► api:8000 (prefix stripped)
                                           ├─ /ws     ─► api:8000 (WebSocket)
                                           └─ else    ─► the dashboard build (static files)
Power BI Desktop ──5432 (lead's IP only)──► Postgres, as the read-only netra_bi user
```
- **Open to the internet:** 80 (redirects to HTTPS) and 443, both Caddy. Caddy gets the certificate from Let's Encrypt by itself; `<ip>.sslip.io` is a free DNS name that resolves to that IP.
- **Open to one address:** 5432, through an Azure network security group (NSG) rule for the lead's public IP. 22 (SSH) is open only to the deploying laptop's IP.
- **Not reachable from outside:** the API, Redpanda Console, Redpanda, ClickHouse and the lab's nginx are bound to `127.0.0.1` on the VM (`docker-compose.azure.yaml`). Juice Shop and the attackers sit on an internal Docker network with no outside access.
- Two layers: the NSG blocks every port it doesn't list, and the compose file doesn't publish the internal ports in the first place. Docker's published ports skip the VM's own firewall (ufw), so the NSG is the one that counts.
- One address for the dashboard and the API means no CORS problems; `CORS_ORIGINS` is still set to that address only.

## First deployment (already done; repeat on a new VM)
```bash
# On the VM (Docker and the Compose plugin installed, user in the docker group)
git clone https://github.com/Anchxt11/netra.git && cd netra
cp .env.example .env    # then fill every empty value with `openssl rand -hex 16`
make azure-up           # builds the images, starts the core stack, the lab and Caddy
make azure-ps           # every service "healthy" or "running"; topic-init "exited (0)"
```

## Update after a push to `main`
```bash
ssh netra 'cd netra && git pull && make azure-up'
```
`make azure-up` rebuilds only what changed. Data (Postgres, ClickHouse, Redpanda, the certificate) lives in Docker volumes and survives.

## Everyday commands (on the VM)
| what | command |
|---|---|
| status | `make azure-ps` |
| logs | `make azure-logs`, or `docker compose logs -f api` |
| launch an attack | `make attack SCENARIO=brute_force` |
| background attacks off / on | `make auto-off` / `make auto-on` |
| Redpanda Console from your laptop | `ssh -L 8080:localhost:8080 netra`, then http://localhost:8080 |
| stop (keeps data) | `make azure-down` |

## Power BI access
Add the lead's address to the NSG (find it at https://ifconfig.me on their laptop):
```bash
az network nsg rule create -g netra-rg --nsg-name netra-vm-nsg -n postgres-powerbi --priority 1030 \
  --source-address-prefixes <LEAD_IP>/32 --destination-port-ranges 5432 --protocol Tcp --access Allow
```
Then follow POWER_BI.md with server `20.244.8.57` and the `BI_PASSWORD` from the VM's `.env`. If the lead's address changes (a new network), update the rule: `az network nsg rule update ... --source-address-prefixes <NEW_IP>/32`.

## Changing a password later
`ADMIN_PASSWORD`, `ANALYST_PASSWORD`, `JWT_SECRET` and `BI_PASSWORD` apply on the next `make azure-up`. `POSTGRES_PASSWORD` and `CLICKHOUSE_PASSWORD` are set only when their volume is first created, so change them inside the database too (`ALTER USER soc PASSWORD '...'` in Postgres) before updating `.env`.

## Cost
`Standard_D4as_v4` in Central India costs roughly USD 0.17 to 0.20 an hour (check the Azure pricing calculator before quoting it). **Deallocate it when not in use**, so compute stops being billed (the disk and public IP still cost a little):
```bash
az vm deallocate -g netra-rg -n netra-vm     # stop billing for compute
az vm start -g netra-rg -n netra-vm          # the stack comes back by itself (restart: unless-stopped)
```
The public IP (`netra-vm-ip`, Standard SKU) is static, so the sslip.io name and the certificate survive a deallocate.
