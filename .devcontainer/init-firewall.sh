#!/bin/bash
set -euo pipefail
IFS=$'\n\t'

# Scout Quest devcontainer firewall
# Allows: GitHub, npm, Anthropic API, GCP APIs, Terraform registries
# Blocks: everything else

# 1. Preserve Docker DNS before flushing
DOCKER_DNS_RULES=$(iptables-save -t nat | grep "127.0.0.11" || true)

# Flush existing rules
iptables -F
iptables -X
iptables -t nat -F
iptables -t nat -X
iptables -t mangle -F
iptables -t mangle -X
ipset destroy allowed-domains 2>/dev/null || true

# 2. Restore Docker DNS
if [ -n "$DOCKER_DNS_RULES" ]; then
    echo "Restoring Docker DNS rules..."
    iptables -t nat -N DOCKER_OUTPUT 2>/dev/null || true
    iptables -t nat -N DOCKER_POSTROUTING 2>/dev/null || true
    echo "$DOCKER_DNS_RULES" | xargs -L 1 iptables -t nat
else
    echo "No Docker DNS rules to restore"
fi

# Allow DNS, SSH, localhost before restrictions
iptables -A OUTPUT -p udp --dport 53 -j ACCEPT
iptables -A INPUT -p udp --sport 53 -j ACCEPT
iptables -A OUTPUT -p tcp --dport 22 -j ACCEPT
iptables -A INPUT -p tcp --sport 22 -m state --state ESTABLISHED -j ACCEPT
iptables -A INPUT -i lo -j ACCEPT
iptables -A OUTPUT -o lo -j ACCEPT

# Create ipset for allowed domains
ipset create allowed-domains hash:net

# --- GitHub IPs ---
echo "Fetching GitHub IP ranges..."
gh_ranges=$(curl -s https://api.github.com/meta)
if [ -z "$gh_ranges" ]; then
    echo "ERROR: Failed to fetch GitHub IP ranges"
    exit 1
fi

echo "Processing GitHub IPs..."
while read -r cidr; do
    if [[ "$cidr" =~ ^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}/[0-9]{1,2}$ ]]; then
        ipset add allowed-domains "$cidr" 2>/dev/null || true
    fi
done < <(echo "$gh_ranges" | jq -r '(.web + .api + .git)[]' | aggregate -q)

# --- Allowed domains ---
# Core services + GCP APIs + Terraform registries
for domain in \
    "registry.npmjs.org" \
    "api.anthropic.com" \
    "sentry.io" \
    "statsig.anthropic.com" \
    "statsig.com" \
    "oauth2.googleapis.com" \
    "accounts.google.com" \
    "storage.googleapis.com" \
    "compute.googleapis.com" \
    "cloudresourcemanager.googleapis.com" \
    "iam.googleapis.com" \
    "secretmanager.googleapis.com" \
    "iap.googleapis.com" \
    "dns.googleapis.com" \
    "www.googleapis.com" \
    "tunnel.cloudproxy.app" \
    "releases.hashicorp.com" \
    "registry.terraform.io" \
    "checkpoint-api.hashicorp.com" \
    "marketplace.visualstudio.com" \
    "vscode.blob.core.windows.net" \
    "update.code.visualstudio.com"; do
    ips=$(dig +noall +answer A "$domain" | awk '$4 == "A" {print $5}')
    if [ -z "$ips" ]; then
        echo "WARNING: Failed to resolve $domain (skipping)"
        continue
    fi
    while read -r ip; do
        if [[ "$ip" =~ ^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$ ]]; then
            ipset add allowed-domains "$ip" 2>/dev/null || true
        fi
    done < <(echo "$ips")
done

# --- GCP IP ranges (broad — needed for IAP tunnels, GCS, etc.) ---
echo "Adding Google Cloud IP ranges..."
for cidr in \
    "35.235.240.0/20" \
    "199.36.153.4/30" \
    "199.36.153.8/30" \
    "142.250.0.0/15" \
    "172.217.0.0/16" \
    "216.58.192.0/19" \
    "74.125.0.0/16"; do
    ipset add allowed-domains "$cidr" 2>/dev/null || true
done

# Host network
HOST_IP=$(ip route | grep default | cut -d" " -f3)
if [ -n "$HOST_IP" ]; then
    HOST_NETWORK=$(echo "$HOST_IP" | sed "s/\.[0-9]*$/.0\/24/")
    iptables -A INPUT -s "$HOST_NETWORK" -j ACCEPT
    iptables -A OUTPUT -d "$HOST_NETWORK" -j ACCEPT
fi

# Set default policies
iptables -P INPUT DROP
iptables -P FORWARD DROP
iptables -P OUTPUT DROP

# Allow established connections
iptables -A INPUT -m state --state ESTABLISHED,RELATED -j ACCEPT
iptables -A OUTPUT -m state --state ESTABLISHED,RELATED -j ACCEPT

# Allow only whitelisted outbound
iptables -A OUTPUT -m set --match-set allowed-domains dst -j ACCEPT

# Reject everything else
iptables -A OUTPUT -j REJECT --reject-with icmp-admin-prohibited

echo "Firewall configuration complete"

# Verify
if curl --connect-timeout 5 https://example.com >/dev/null 2>&1; then
    echo "WARNING: Firewall verification failed — example.com reachable"
else
    echo "Firewall OK — blocked domains unreachable"
fi

if curl --connect-timeout 5 https://api.github.com/zen >/dev/null 2>&1; then
    echo "Firewall OK — GitHub reachable"
else
    echo "WARNING: GitHub unreachable — check firewall config"
fi
