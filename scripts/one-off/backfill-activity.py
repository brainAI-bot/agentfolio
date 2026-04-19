#!/usr/bin/env python3
"""
Activity Heatmap Backfill Script for AgentFolio
Scans profile JSON, escrow records, marketplace data, and verification dates
to generate activity.json per profile.

Activity event types:
- profile_created: When profile was first created
- verification: When a platform was verified (github, solana, x, etc.)
- endorsement_given / endorsement_received
- escrow_created / escrow_funded / escrow_released / escrow_refunded
- job_posted / job_completed
- application_submitted / application_accepted
- deliverable_submitted / deliverable_approved
- nft_minted / nft_burned (soulbound)

Output: data/profiles/<id>/activity.json (or writes activity field into profile JSON)
"""

import json
import glob
import os
import sys
from datetime import datetime

DATA_DIR = "/home/ubuntu/agentfolio/data"
PROFILES_DIR = f"{DATA_DIR}/profiles"
ESCROW_DIR = f"{DATA_DIR}/escrow/escrows"
TX_DIR = f"{DATA_DIR}/escrow/transactions"
MARKETPLACE_DIR = f"{DATA_DIR}/marketplace"
OUTPUT_DIR = f"{DATA_DIR}/activity"

def load_json(path):
    try:
        with open(path) as f:
            data = json.load(f)
            # Handle files that contain arrays (some apps are wrapped in [])
            if isinstance(data, list):
                return data[0] if data else {}
            return data
    except Exception as e:
        print(f"  WARN: Failed to load {path}: {e}", file=sys.stderr)
        return {}

def extract_profile_events(profile):
    """Extract events from a single profile JSON."""
    events = []
    pid = profile.get("id", "unknown")
    
    # Profile creation
    created = profile.get("createdAt") or profile.get("created_at")
    if created:
        events.append({"type": "profile_created", "date": created, "detail": f"Profile {pid} created"})
    
    # Verification dates
    vd = profile.get("verificationData", {})
    for platform, data in vd.items():
        if not isinstance(data, dict):
            continue
        for date_key in ["verifiedAt", "checkedAt", "linkedAt"]:
            if date_key in data and data.get("verified", data.get("success", False)):
                events.append({
                    "type": "verification",
                    "date": data[date_key],
                    "detail": f"{platform} verified",
                    "platform": platform
                })
    
    # SATP verification
    satp = vd.get("satp", {})
    if satp.get("verified") and satp.get("verifiedAt"):
        events.append({"type": "verification", "date": satp["verifiedAt"], "detail": "SATP on-chain identity verified", "platform": "satp"})
    
    # NFT avatar (burn-to-become soulbound)
    nft = profile.get("nftAvatar", {})
    if nft and nft.get("burnedAt"):
        events.append({"type": "nft_burned", "date": nft["burnedAt"], "detail": f"Soulbound NFT: {nft.get('name', 'NFT')}"})
    if nft and nft.get("verifiedAt") and nft.get("verifiedAt") != nft.get("burnedAt"):
        events.append({"type": "nft_minted", "date": nft["verifiedAt"], "detail": "NFT avatar verified on-chain"})
    
    # Endorsements received
    for e in profile.get("endorsements", []):
        if e.get("createdAt"):
            events.append({
                "type": "endorsement_received",
                "date": e["createdAt"],
                "detail": f"Endorsed by {e.get('fromName', e.get('fromId', 'unknown'))}",
                "fromId": e.get("fromId")
            })
    
    # Endorsements given
    for e in profile.get("endorsementsGiven", []):
        if e.get("createdAt"):
            events.append({
                "type": "endorsement_given",
                "date": e["createdAt"],
                "detail": f"Endorsed {e.get('toName', e.get('toId', 'unknown'))}",
                "toId": e.get("toId")
            })
    
    return events

def extract_escrow_events():
    """Extract events from escrow records, keyed by agent ID."""
    agent_events = {}  # agentId -> [events]
    
    for f in glob.glob(f"{ESCROW_DIR}/*.json"):
        esc = load_json(f)
        if not esc:
            continue
        
        client = esc.get("clientId")
        agent = esc.get("agentId")
        eid = esc.get("id", "unknown")
        status = esc.get("status", "unknown")
        created = esc.get("createdAt")
        amount = esc.get("amount", 0)
        currency = esc.get("currency", "USDC")
        
        # Created event for client
        if client and created:
            agent_events.setdefault(client, []).append({
                "type": "escrow_created",
                "date": created,
                "detail": f"Escrow {eid} created: {amount} {currency}",
                "escrowId": eid,
                "amount": amount,
                "role": "client"
            })
        
        # Status-based events
        if status == "funded" or status in ("locked", "agent_accepted", "released", "refunded"):
            # Deposit confirmed
            dep_at = esc.get("depositConfirmedAt")
            if dep_at and client:
                agent_events.setdefault(client, []).append({
                    "type": "escrow_funded",
                    "date": dep_at,
                    "detail": f"Escrow {eid} funded: {amount} {currency}",
                    "escrowId": eid,
                    "amount": amount
                })
        
        if status == "released":
            rel_at = esc.get("releasedAt")
            if rel_at:
                if client:
                    agent_events.setdefault(client, []).append({
                        "type": "escrow_released",
                        "date": rel_at,
                        "detail": f"Released {amount} {currency} to {agent or 'agent'}",
                        "escrowId": eid,
                        "amount": amount,
                        "role": "client"
                    })
                if agent:
                    agent_events.setdefault(agent, []).append({
                        "type": "escrow_released",
                        "date": rel_at,
                        "detail": f"Received {amount} {currency} from {client or 'client'}",
                        "escrowId": eid,
                        "amount": amount,
                        "role": "agent"
                    })
        
        if status == "refunded":
            # Use notes to find refund date or fall back to updatedAt
            refund_at = esc.get("updatedAt", created)
            for note in esc.get("notes", []):
                if note.get("action") == "refunded":
                    refund_at = note.get("timestamp", refund_at)
            if client:
                agent_events.setdefault(client, []).append({
                    "type": "escrow_refunded",
                    "date": refund_at,
                    "detail": f"Escrow {eid} refunded: {amount} {currency}",
                    "escrowId": eid,
                    "amount": amount
                })
    
    return agent_events

def extract_marketplace_events():
    """Extract events from marketplace jobs, applications, deliverables."""
    agent_events = {}
    
    # Jobs
    for f in glob.glob(f"{MARKETPLACE_DIR}/jobs/*.json"):
        job = load_json(f)
        if not job:
            continue
        client = job.get("clientId")
        jid = job.get("id")
        created = job.get("createdAt")
        if client and created:
            agent_events.setdefault(client, []).append({
                "type": "job_posted",
                "date": created,
                "detail": f"Posted job: {job.get('title', jid)[:60]}",
                "jobId": jid
            })
        if job.get("status") == "completed":
            updated = job.get("updatedAt", created)
            if client:
                agent_events.setdefault(client, []).append({
                    "type": "job_completed",
                    "date": updated,
                    "detail": f"Job completed: {job.get('title', jid)[:60]}",
                    "jobId": jid
                })
    
    # Applications
    for f in glob.glob(f"{MARKETPLACE_DIR}/applications/*.json"):
        app = load_json(f)
        if not app:
            continue
        agent = app.get("agentId") or app.get("applicantId")
        if agent and not agent.startswith("agent_"):
            agent = f"agent_{agent}"
        created = app.get("createdAt") or app.get("appliedAt")
        if agent and created:
            agent_events.setdefault(agent, []).append({
                "type": "application_submitted",
                "date": created,
                "detail": f"Applied to job {app.get('jobId', 'unknown')}",
                "jobId": app.get("jobId"),
                "appId": app.get("id")
            })
        if app.get("status") == "accepted" and app.get("acceptedAt"):
            if agent:
                agent_events.setdefault(agent, []).append({
                    "type": "application_accepted",
                    "date": app["acceptedAt"],
                    "detail": f"Application accepted for {app.get('jobId', 'unknown')}",
                    "jobId": app.get("jobId"),
                    "appId": app.get("id")
                })
    
    # Deliverables
    for f in glob.glob(f"{MARKETPLACE_DIR}/deliverables/*.json"):
        dlv = load_json(f)
        if not dlv:
            continue
        agent = dlv.get("submittedBy")
        if agent and not agent.startswith("agent_"):
            agent = f"agent_{agent}"
        submitted = dlv.get("submittedAt")
        if agent and submitted:
            agent_events.setdefault(agent, []).append({
                "type": "deliverable_submitted",
                "date": submitted,
                "detail": f"Deliverable for job {dlv.get('jobId', 'unknown')}",
                "jobId": dlv.get("jobId"),
                "dlvId": dlv.get("id")
            })
            if dlv.get("status") == "approved":
                agent_events.setdefault(agent, []).append({
                    "type": "deliverable_approved",
                    "date": submitted,  # Use submitted as approvedAt not always present
                    "detail": f"Deliverable approved for {dlv.get('jobId', 'unknown')}",
                    "jobId": dlv.get("jobId")
                })
    
    return agent_events

def build_heatmap(events):
    """Convert events list to date->count heatmap for frontend."""
    heatmap = {}
    for e in events:
        date_str = e.get("date", "")[:10]  # YYYY-MM-DD
        if date_str:
            heatmap[date_str] = heatmap.get(date_str, 0) + 1
    return heatmap

def main():
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    
    # Collect all cross-profile events
    escrow_events = extract_escrow_events()
    marketplace_events = extract_marketplace_events()
    
    total_profiles = 0
    total_events = 0
    profiles_with_activity = 0
    
    for f in sorted(glob.glob(f"{PROFILES_DIR}/*.json")):
        profile = load_json(f)
        if not profile:
            continue
        
        pid = profile.get("id", os.path.basename(f).replace(".json", ""))
        total_profiles += 1
        
        # Merge all event sources
        events = []
        events.extend(extract_profile_events(profile))
        events.extend(escrow_events.get(pid, []))
        events.extend(marketplace_events.get(pid, []))
        
        # Deduplicate by (type, date)
        seen = set()
        unique_events = []
        for e in events:
            key = (e["type"], e["date"][:19])  # Dedup to second precision
            if key not in seen:
                seen.add(key)
                unique_events.append(e)
        
        # Sort by date
        unique_events.sort(key=lambda x: x.get("date", ""))
        
        # Build heatmap
        heatmap = build_heatmap(unique_events)
        
        # Write activity.json
        activity_data = {
            "profileId": pid,
            "generatedAt": datetime.utcnow().isoformat() + "Z",
            "totalEvents": len(unique_events),
            "heatmap": heatmap,
            "events": unique_events
        }
        
        out_path = f"{OUTPUT_DIR}/{pid}.activity.json"
        with open(out_path, "w") as outf:
            json.dump(activity_data, outf, indent=2)
        
        total_events += len(unique_events)
        if unique_events:
            profiles_with_activity += 1
            print(f"  ✓ {pid}: {len(unique_events)} events, {len(heatmap)} active days")
        else:
            print(f"  · {pid}: no activity")
    
    print(f"\n{'='*50}")
    print(f"BACKFILL COMPLETE")
    print(f"  Profiles scanned: {total_profiles}")
    print(f"  Profiles with activity: {profiles_with_activity}")
    print(f"  Total events generated: {total_events}")
    print(f"  Output: {OUTPUT_DIR}/<profileId>.activity.json")

if __name__ == "__main__":
    main()
