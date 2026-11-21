#!/usr/bin/env python3
"""End-to-end checks against the harness GraphQL server on :4000.
Each check prints PASS/FAIL with the evidence. Exit 0 only if all pass."""
import json
import urllib.request
import urllib.error

BASE = "http://127.0.0.1:4000/api/graphql"
results = []


def gql(query, variables=None, demo_user=None):
    body = json.dumps({"query": query, "variables": variables or {}}).encode()
    req = urllib.request.Request(BASE, data=body, method="POST")
    req.add_header("Content-Type", "application/json")
    if demo_user:
        req.add_header("x-demo-user", demo_user)
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        return json.loads(e.read())


def get_counts():
    with urllib.request.urlopen("http://127.0.0.1:4000/__counts", timeout=5) as r:
        return json.loads(r.read())


def reset_counts():
    req = urllib.request.Request("http://127.0.0.1:4000/__reset-counts", data=b"", method="POST")
    urllib.request.urlopen(req, timeout=5).read()


def check(name, cond, evidence=""):
    results.append((name, bool(cond)))
    print(f"{'PASS' if cond else 'FAIL'}  {name}  {evidence}")


# 1. viewer as Northstar client: only Northstar tenant permitted
r = gql("{ viewer { name role permittedTenants { slug } } }", demo_user="client-northstar")
v = r.get("data", {}).get("viewer", {})
check("viewer northstar", v.get("name") == "Amina Patel" and v.get("role") == "CLIENT"
      and [t["slug"] for t in v.get("permittedTenants", [])] == ["northstar"], json.dumps(v))

# 2. viewer as manager: both tenants
r = gql("{ viewer { name role permittedTenants { slug } } }", demo_user="manager-sysfortech")
v = r.get("data", {}).get("viewer", {})
check("viewer manager both tenants", [t["slug"] for t in v.get("permittedTenants", [])] == ["harborline", "northstar"], json.dumps(v))

# 3. projects page 1 (first:2) as northstar: only NSR, newest first
q = "query($first:Int,$after:String){ projects(first:$first, after:$after){ edges{ cursor node{ code createdAt } } pageInfo{ hasNextPage endCursor } } }"
r = gql(q, {"first": 2}, demo_user="client-northstar")
p = r["data"]["projects"]
codes = [e["node"]["code"] for e in p["edges"]]
check("projects p1 northstar only", codes == ["NSR-101", "NSR-102"] and p["pageInfo"]["hasNextPage"] is True, json.dumps(codes))
cursor = p["pageInfo"]["endCursor"]

# 4. page 2 via cursor: tied-timestamp trio must not skip or repeat
r = gql(q, {"first": 3, "after": cursor}, demo_user="client-northstar")
p = r["data"]["projects"]
codes2 = [e["node"]["code"] for e in p["edges"]]
check("projects p2 tie-break", codes2 == ["NSR-103", "NSR-104", "NSR-105"] and p["pageInfo"]["hasNextPage"] is False, json.dumps(codes2))

# 5. tenantId filter for the OTHER tenant -> empty (intersection, not access)
q2 = "query($first:Int,$tenantId:ID){ projects(first:$first, tenantId:$tenantId){ edges{ cursor node{ code } } pageInfo{ hasNextPage endCursor } } }"
r = gql(q2, {"first": 10, "tenantId": "tenant_harborline"}, demo_user="client-northstar")
p = r["data"]["projects"]
check("cross-tenant filter empty", p["edges"] == [] and p["pageInfo"]["hasNextPage"] is False, json.dumps(p))

# 6. direct project lookup across tenants -> null
r = gql('{ project(id:"proj_hbl_201_berth"){ code } }', demo_user="client-northstar")
check("cross-tenant project null", r["data"]["project"] is None, json.dumps(r["data"]))
r = gql('{ project(id:"proj_hbl_201_berth"){ code } }', demo_user="client-harborline")
check("own-tenant project visible", r["data"]["project"] == {"code": "HBL-201"}, json.dumps(r["data"]))

# 7. direct invoice lookup across tenants -> null; own -> data
r = gql('{ invoice(id:"inv_hbl_2026_002"){ invoiceNumber status amountCents } }', demo_user="client-northstar")
check("cross-tenant invoice null", r["data"]["invoice"] is None, json.dumps(r["data"]))
r = gql('{ invoice(id:"inv_hbl_2026_002"){ invoiceNumber status amountCents lineItems{ label } } }', demo_user="client-harborline")
inv = r["data"]["invoice"]
check("own-tenant invoice visible", inv and inv["invoiceNumber"] == "INV-HBL-2026-02" and inv["status"] == "OVERDUE", json.dumps(inv))

# 8. createTicket on another tenant's project -> NOT_FOUND (same as unknown id)
r = gql('mutation{ createTicket(projectId:"proj_hbl_201_berth", input:{title:"Should not work here", description:"cross tenant attempt description"}){ id } }',
        demo_user="client-northstar")
err = (r.get("errors") or [{}])[0]
check("createTicket cross-tenant NOT_FOUND", err.get("extensions", {}).get("code") == "NOT_FOUND", json.dumps(err))
r = gql('mutation{ createTicket(projectId:"proj_hbl_201_berth", input:{title:"Should not work here", description:"cross tenant attempt description"}){ id } }',
        demo_user="client-northstar")
# unknown project id must give the identical error (no oracle)
r2 = gql('mutation{ createTicket(projectId:"proj_does_not_exist", input:{title:"Should not work here", description:"unknown project attempt description"}){ id } }',
        demo_user="client-northstar")
err2 = (r2.get("errors") or [{}])[0]
check("unknown project identical error", err.get("message") == err2.get("message") and err.get("extensions") == err2.get("extensions"), f"{err} vs {err2}")

# 9. createTicket on own project -> works, author attached
r = gql('mutation{ createTicket(projectId:"proj_nsr_101_b2b", input:{title:"Net-30 pooled credit check", description:"Please confirm pooled parent credit applies."}){ id title status priority createdBy{ name } } }',
        demo_user="client-northstar")
t = r["data"]["createTicket"]
check("createTicket own project", t and t["status"] == "OPEN" and t["createdBy"]["name"] == "Amina Patel", json.dumps(t))

# 10. updateTicketStatus as CLIENT -> FORBIDDEN; as MANAGER -> works
r = gql('mutation{ updateTicketStatus(ticketId:"tkt_nsr_001", status:RESOLVED){ status } }', demo_user="client-northstar")
err = (r.get("errors") or [{}])[0]
check("updateTicketStatus client FORBIDDEN", err.get("extensions", {}).get("code") == "FORBIDDEN", json.dumps(err))
r = gql('mutation{ updateTicketStatus(ticketId:"tkt_nsr_001", status:RESOLVED){ status } }', demo_user="manager-sysfortech")
check("updateTicketStatus manager OK", r["data"]["updateTicketStatus"] == {"status": "RESOLVED"}, json.dumps(r["data"]))

# 11. validation: bad cursor, first:0, first:51, short title
r = gql(q, {"first": 2, "after": "!!!not-a-cursor!!!"}, demo_user="client-northstar")
err = (r.get("errors") or [{}])[0]
check("bad cursor BAD_USER_INPUT", err.get("extensions", {}).get("code") == "BAD_USER_INPUT", json.dumps(err))
r = gql(q, {"first": 0}, demo_user="client-northstar")
err = (r.get("errors") or [{}])[0]
check("first:0 BAD_USER_INPUT", err.get("extensions", {}).get("code") == "BAD_USER_INPUT", json.dumps(err))
r = gql(q, {"first": 51}, demo_user="client-northstar")
err = (r.get("errors") or [{}])[0]
check("first:51 BAD_USER_INPUT", err.get("extensions", {}).get("code") == "BAD_USER_INPUT", json.dumps(err))

# 12. unknown demo identity -> UNAUTHENTICATED
r = gql("{ viewer { name } }", demo_user="client-evil")
err = (r.get("errors") or [{}])[0]
check("unknown identity UNAUTHENTICATED", err.get("extensions", {}).get("code") == "UNAUTHENTICATED", json.dumps(err))

# 13. N+1: one projects query with invoices+tickets for all 5 NSR projects
reset_counts()
r = gql("query{ projects(first:5){ edges{ node{ code invoices{ invoiceNumber } tickets{ title } } } } }", demo_user="client-northstar")
n_projects = len(r["data"]["projects"]["edges"])
c = get_counts()
check("dataloader batches invoices+tickets", n_projects == 5 and c.get("invoice.findMany") == 1 and c.get("ticket.findMany") == 1,
      f"projects={n_projects} counts={json.dumps(c)}")

print()
failed = [n for n, ok in results if not ok]
print(f"{len(results) - len(failed)}/{len(results)} checks passed")
raise SystemExit(1 if failed else 0)
