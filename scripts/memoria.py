"""Write a note into the Hub's Memória (Sistema > Memória), so the team and the Team AI know what changed and why.

    python scripts/memoria.py WIDGET "Vídeos no widget" "O Chromium do Qt não tem H.264: ..."
    python scripts/memoria.py --list

A note with the same title in the same place is rewritten, not repeated, so the Memória keeps the current state.
It talks to this PC's own Hub (127.0.0.1:8000) and signs in as the person this PC belongs to; the note then
reaches the other PCs by sync. --scope/--id put it under a company, project or agent instead of the team.
"""
import argparse
import json
import sys
import urllib.request

HUB = "http://127.0.0.1:8000"


def call(method, path, token=None, body=None):
    request = urllib.request.Request(HUB + path, method=method, data=json.dumps(body).encode() if body is not None else None,
                                     headers={"Content-Type": "application/json", **({"Authorization": f"Bearer {token}"} if token else {})})
    with urllib.request.urlopen(request, timeout=10) as response:
        return json.loads(response.read() or b"null")


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description="Write a note into the Hub's Memória.")
    parser.add_argument("category", nargs="?", help="WIDGET, HUB, TELEMÓVEL, DESIGN, REGRAS, ...")
    parser.add_argument("title", nargs="?")
    parser.add_argument("content", nargs="?", default="")
    parser.add_argument("--scope", default="team", choices=["team", "global", "company", "project", "agent", "task"])
    parser.add_argument("--id", default="", help="the company, project, agent or task the note belongs to")
    parser.add_argument("--list", action="store_true", help="show what the Memória has")
    args = parser.parse_args()

    token = call("POST", "/api/auth/auto")["token"]
    notes = call("GET", "/api/memory", token)
    if args.list or not args.title:
        for m in notes:
            place = m["scope"] + (f" {m['scope_id']}" if m["scope_id"] else "")
            print(f"[{place}] {m['category'] or '-'} | {m['title']}")
        return
    body = {"category": args.category.strip().upper(), "title": args.title.strip(), "content": args.content.strip()}
    same = next((m for m in notes if m["scope"] == args.scope and m["scope_id"] == args.id
                 and m["title"].strip().lower() == body["title"].lower()), None)
    if same:
        call("PUT", f"/api/memory/{same['id']}", token, body)
        print("rewritten:", body["title"])
    else:
        call("POST", "/api/memory", token, {**body, "scope": args.scope, "scope_id": args.id})
        print("added:", body["title"])


if __name__ == "__main__":
    main()
