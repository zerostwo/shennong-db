import argparse
import json
import sys
import time

def serve():
    for raw in sys.stdin:
        request = json.loads(raw)
        uri = request.get("uri")
        if uri == "sleep":
            time.sleep(3)
        elif uri == "exit":
            sys.stderr.write("Traceback: /data/private-array\n")
            print(json.dumps({"status": "error", "error": "backend failed"}), flush=True)
            continue
        elif uri == "stdout":
            print(json.dumps({"status": "success", "data": "x" * 2048}), flush=True)
            continue
        elif uri == "stderr":
            sys.stderr.write("x" * 2048)
            print(json.dumps({"status": "error", "error": "backend failed"}), flush=True)
            continue
        print(json.dumps({"status": "success", "data": [], "meta": {"backend": "tiledb"}}), flush=True)

parser = argparse.ArgumentParser()
parser.add_argument("command")
parser.add_argument("--uri")
parser.add_argument("--feature")
parser.add_argument("--limit")
args = parser.parse_args()

if args.command == "serve":
    serve()
    raise SystemExit(0)

if args.uri == "sleep":
    time.sleep(3)
elif args.uri == "exit":
    sys.stderr.write("Traceback: /data/private-array\n")
    raise SystemExit(3)
elif args.uri == "stdout":
    sys.stdout.write("x" * 2048)
    raise SystemExit(0)
elif args.uri == "stderr":
    sys.stderr.write("x" * 2048)
    raise SystemExit(4)

print(json.dumps({"status": "success", "data": [], "meta": {"backend": "tiledb"}}))
