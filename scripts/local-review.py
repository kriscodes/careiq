#!/usr/bin/env python3
"""Isolated loopback review environment; never consumes a remote database URL."""

from __future__ import annotations

import argparse
import fcntl
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import signal
import socket
import subprocess
import sys
import time
from urllib.parse import quote, urlparse
from urllib.request import build_opener, ProxyHandler

ROOT = Path(__file__).resolve().parents[1]
STATE = ROOT / ".local-review"
CONTAINER = "careiq-auth-review-db"
VOLUME = "careiq-auth-review-pgdata"
DB_PORT = 55434
RUNTIME_ROLE = "careiq_review_runtime"
LABEL = "com.careiq.local-review"
APPS = {
    "api": {"directory": "apps/api", "port": 3100, "url": "http://localhost:3100/health", "health": "/health"},
    "web": {"directory": "apps/web", "port": 3101, "url": "http://localhost:3101/design-preview", "health": "/design-preview"},
    "marketing": {"directory": "apps/marketing", "port": 3102, "url": "http://localhost:3102", "health": "/"},
    "mobile": {"directory": "apps/mobile", "port": 8082, "url": "http://localhost:8082/design-preview", "health": "/design-preview"},
}
PRIVATE_VALUES: set[str] = set()


class ReviewError(Exception):
    pass


def check_node_runtime():
    guidance = "Use the repository-pinned Node.js 22.23.2 (for nvm, run nvm use)."
    binary = shutil.which("node")
    if not binary:
        raise ReviewError(f"Node.js 22.13 or newer is required. {guidance}")
    result = subprocess.run([binary, "--version"], text=True, capture_output=True)
    version = result.stdout.strip()
    match = re.fullmatch(r"v(\d+)\.(\d+)\.(\d+)(?:[-+].*)?", version)
    if result.returncode or not match:
        raise ReviewError(f"Could not validate the Node.js runtime. {guidance}")
    if tuple(int(part) for part in match.groups()) < (22, 13, 0):
        raise ReviewError(f"Node.js {version} is unsupported; 22.13 or newer is required. {guidance}")


def private_state():
    STATE.mkdir(mode=0o700, exist_ok=True)
    os.chmod(STATE, 0o700)


def write_private(path: Path, value: str):
    temporary = path.with_name(path.name + ".new")
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(descriptor, "w") as stream:
        stream.write(value)
    os.chmod(temporary, 0o600)
    os.replace(temporary, path)


def read_env(path: Path):
    values = {}
    if not path.exists():
        return values
    for original in path.read_text().splitlines():
        line = original.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[7:]
        key, separator, value = line.partition("=")
        if not separator:
            continue
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        else:
            value = value.split(" #", 1)[0].rstrip()
        values[key.strip()] = value
        if any(fragment in key for fragment in ("SECRET", "PASSWORD", "DATABASE_URL", "CLERK_PUBLISHABLE_KEY")) and value:
            PRIVATE_VALUES.add(value)
    return values


def redacted(value: str):
    for secret in sorted(PRIVATE_VALUES, key=len, reverse=True):
        value = value.replace(secret, "[redacted]")
    return value


def command_run(arguments, *, input_text=None, environment=None):
    result = subprocess.run(arguments, input=input_text, text=True, capture_output=True, env=environment)
    if result.returncode:
        private_state()
        with (STATE / "setup.log").open("a") as stream:
            os.chmod(STATE / "setup.log", 0o600)
            stream.write(redacted(result.stdout + result.stderr))
        raise ReviewError(f"Local command failed ({Path(arguments[0]).name}); inspect .local-review/setup.log.")
    return result.stdout


def docker_binary():
    binary = shutil.which("docker") or "/Applications/Docker.app/Contents/Resources/bin/docker"
    if not Path(binary).exists():
        raise ReviewError("Docker is required for the isolated local review database.")
    return binary


def docker(*arguments, input_text=None):
    return command_run([docker_binary(), *arguments], input_text=input_text)


def occupied(port: int):
    for family, address in ((socket.AF_INET, "127.0.0.1"), (socket.AF_INET6, "::1")):
        try:
            with socket.socket(family) as connection:
                connection.settimeout(0.2)
                if connection.connect_ex((address, port)) == 0:
                    return True
        except OSError:
            continue
    return False


def database_config():
    private_state()
    path = STATE / "database.json"
    if path.exists():
        configuration = json.loads(path.read_text())
    else:
        configuration = {"container": CONTAINER, "port": DB_PORT, "password": secrets.token_hex(24)}
        write_private(path, json.dumps(configuration) + "\n")
    if configuration.get("container") != CONTAINER or configuration.get("port") != DB_PORT or not configuration.get("password"):
        raise ReviewError("Review database metadata differs from this runner; no environment was changed.")
    PRIVATE_VALUES.add(configuration["password"])
    os.chmod(path, 0o600)
    return configuration


def inspect_database():
    result = subprocess.run([docker_binary(), "inspect", CONTAINER], text=True, capture_output=True)
    if result.returncode:
        return None
    details = json.loads(result.stdout)[0]
    bindings = details["HostConfig"].get("PortBindings", {}).get("5432/tcp", [])
    mounted = any(mount.get("Type") == "volume" and mount.get("Name") == VOLUME for mount in details.get("Mounts", []))
    if (details["Config"].get("Labels", {}).get(LABEL) != "true" or
        details["Config"].get("Image") != "postgres:18.6" or not mounted or
        bindings != [{"HostIp": "127.0.0.1", "HostPort": str(DB_PORT)}]):
        raise ReviewError("Container identity, image, volume or loopback binding differs; no container was changed.")
    return details


def ensure_database():
    configuration = database_config()
    details = inspect_database()
    if details is None:
        if occupied(DB_PORT):
            raise ReviewError("Review database port is occupied; the existing service was left untouched.")
        bootstrap = STATE / "docker.env"
        write_private(bootstrap, f"POSTGRES_PASSWORD={configuration['password']}\nPOSTGRES_DB=careiq_review\n")
        docker("run", "-d", "--name", CONTAINER, "--label", f"{LABEL}=true",
               "-p", f"127.0.0.1:{DB_PORT}:5432", "--mount", f"type=volume,src={VOLUME},dst=/var/lib/postgresql",
               "--env-file", str(bootstrap), "postgres:18.6")
    elif not details["State"]["Running"]:
        if occupied(DB_PORT):
            raise ReviewError("Review database port is occupied; the stopped review container was left untouched.")
        docker("start", details["Id"])
    for _attempt in range(30):
        check = subprocess.run([docker_binary(), "exec", CONTAINER, "pg_isready", "-U", "postgres"], capture_output=True)
        if check.returncode == 0:
            break
        time.sleep(0.5)
    else:
        raise ReviewError("The isolated review database did not become ready.")
    names = docker("exec", CONTAINER, "psql", "-U", "postgres", "-Atc", "SELECT datname FROM pg_database").splitlines()
    for name in ("careiq_review", "careiq_test"):
        if name not in names:
            docker("exec", CONTAINER, "createdb", "-U", "postgres", name)
    base = f"postgresql://postgres:{quote(configuration['password'], safe='')}@127.0.0.1:{DB_PORT}"
    write_private(STATE / "database.env", f"DATABASE_URL={base}/careiq_review\nDATABASE_SSL_MODE=disable\n")
    write_private(STATE / "test.env", f"TEST_DATABASE_URL={base}/careiq_test\nDATABASE_SSL_MODE=disable\n")


def clean_environment():
    allowed = {"PATH", "HOME", "TMPDIR", "USER", "LOGNAME", "SHELL", "LANG", "LC_ALL", "LC_CTYPE", "TZ", "TERM", "__CF_USER_TEXT_ENCODING"}
    return {key: value for key, value in os.environ.items() if key in allowed}


def local_url(value: str, username: str, database: str):
    parsed = urlparse(value)
    if parsed.scheme != "postgresql" or parsed.hostname != "127.0.0.1" or parsed.port != DB_PORT or parsed.path != "/" + database or parsed.username != username or parsed.query or parsed.fragment:
        raise ReviewError("Database URL is not this runner's isolated loopback database.")
    if not parsed.password:
        raise ReviewError("The isolated database credential is missing.")
    PRIVATE_VALUES.add(parsed.password)
    return parsed


def migrate_databases():
    binary = ROOT / "apps/api/node_modules/.bin/tsx"
    if not binary.exists():
        raise ReviewError("Workspace dependencies are not installed. Run pnpm install, then local:setup.")
    for filename, key, name in (("database.env", "DATABASE_URL", "careiq_review"), ("test.env", "TEST_DATABASE_URL", "careiq_test")):
        value = read_env(STATE / filename)[key]
        local_url(value, "postgres", name)
        environment = {**clean_environment(), "DATABASE_URL": value, "DATABASE_SSL_MODE": "disable"}
        command_run([str(binary), str(ROOT / "apps/api/src/db/migrate.ts")], environment=environment)


def ensure_runtime():
    path = STATE / "runtime.env"
    existing = read_env(path)
    password = local_url(existing["DATABASE_URL"], RUNTIME_ROLE, "careiq_review").password if existing else secrets.token_hex(24)
    if not password or any(character not in "0123456789abcdef" for character in password):
        raise ReviewError("Runtime credential metadata differs from this runner; no role was changed.")
    PRIVATE_VALUES.add(password)
    marker = "CareIQ isolated local review runner"
    role_sql = f"""
BEGIN;
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='{RUNTIME_ROLE}') THEN
    CREATE ROLE {RUNTIME_ROLE} LOGIN PASSWORD '{password}' INHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION;
    COMMENT ON ROLE {RUNTIME_ROLE} IS '{marker}';
  ELSIF (SELECT shobj_description(oid,'pg_authid') FROM pg_roles WHERE rolname='{RUNTIME_ROLE}') IS DISTINCT FROM '{marker}' THEN
    RAISE EXCEPTION 'Existing runtime role belongs to another environment';
  ELSE
    ALTER ROLE {RUNTIME_ROLE} PASSWORD '{password}';
  END IF;
END $$;
COMMIT;
"""
    docker("exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "careiq_review", "-v", "ON_ERROR_STOP=1", "-f", "-", input_text=role_sql)
    grants = (ROOT / "apps/api/src/db/grant-clinical-runtime.sql").read_text()
    docker("exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "careiq_review", "-v", f"runtime_role={RUNTIME_ROLE}", "-f", "-", input_text=grants)
    value = f"postgresql://{RUNTIME_ROLE}:{password}@127.0.0.1:{DB_PORT}/careiq_review"
    write_private(path, f"DATABASE_URL={value}\nDATABASE_SSL_MODE=disable\nHOST=127.0.0.1\nPORT=3100\nINTERVIEW_REQUESTS_ENABLED=false\nCLERK_NATIVE_AUTH_ENABLED=false\n")


def test_clerk_configuration():
    api = read_env(ROOT / "apps/api/.env")
    web = read_env(ROOT / "apps/web/.env.local")
    publishable = api.get("CLERK_PUBLISHABLE_KEY") or web.get("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY")
    secret = api.get("CLERK_SECRET_KEY") or web.get("CLERK_SECRET_KEY")
    if not publishable or not publishable.startswith("pk_test_") or not secret or not secret.startswith("sk_test_"):
        raise ReviewError("Local review requires existing Clerk test keys. Production keys are never used.")
    if web.get("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY") and web["NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY"] != publishable:
        raise ReviewError("API and web Clerk test applications differ; align the original configuration deliberately.")
    if web.get("CLERK_SECRET_KEY") and web["CLERK_SECRET_KEY"] != secret:
        raise ReviewError("API and web Clerk secret keys differ; no original configuration was changed.")
    return api, publishable, secret


def app_environment(name: str):
    api, publishable, secret = test_clerk_configuration()
    runtime = read_env(STATE / "runtime.env")
    local_url(runtime["DATABASE_URL"], RUNTIME_ROLE, "careiq_review")
    environment = {**clean_environment(), "NODE_ENV": "development", "NEXT_TELEMETRY_DISABLED": "1", "CI": "1"}
    if name == "api":
        founder_ids = api.get("CAREIQ_PRACTICE_CREATOR_USER_IDS", "")
        owner_file = STATE / "owner.env"
        if owner_file.exists():
            override = read_env(owner_file)
            if set(override) != {"CAREIQ_PRACTICE_CREATOR_USER_IDS"}:
                raise ReviewError("owner.env may override only CAREIQ_PRACTICE_CREATOR_USER_IDS.")
            approved = [value.strip() for value in override["CAREIQ_PRACTICE_CREATOR_USER_IDS"].split(",") if value.strip()]
            if any(not re.fullmatch(r"user_[A-Za-z0-9]+", value) for value in approved):
                raise ReviewError("owner.env must contain explicitly confirmed Clerk test user IDs, never an email or wildcard.")
            os.chmod(owner_file, 0o600)
            founder_ids = ",".join(approved)
        origins = [f"http://{host}:{port}" for host in ("localhost", "127.0.0.1") for port in (3101, 3102, 8082)]
        environment.update(runtime)
        environment.update({"CLERK_PUBLISHABLE_KEY": publishable, "CLERK_SECRET_KEY": secret, "CORS_ORIGINS": ",".join(origins),
                            "TRUSTED_PROXY_CIDRS": "", "CLERK_NATIVE_AUTHORIZED_PARTIES": "", "CLERK_WEBHOOK_SIGNING_SECRET": "",
                            "CAREIQ_PRACTICE_CREATOR_USER_IDS": founder_ids,
                            "CAREIQ_STAFF_ROLES": api.get("CAREIQ_STAFF_ROLES", ""), "CAREIQ_INVITATION_REDIRECT_URL": "http://localhost:3101/?invitations=1"})
    elif name == "web":
        environment.update({"NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY": publishable, "CLERK_SECRET_KEY": secret,
                            "NEXT_PUBLIC_API_URL": "http://localhost:3100", "NEXT_PUBLIC_INTERVIEW_MODE": "false",
                            "CAREIQ_LOCAL_REVIEW_DIST_DIR": ".next-local-review"})
    elif name == "marketing":
        environment.update({"NEXT_PUBLIC_SITE_URL": "http://localhost:3102", "NEXT_PUBLIC_API_URL": "http://localhost:3100",
                            "NEXT_PUBLIC_APP_URL": "http://localhost:3101", "NEXT_PUBLIC_ALLOW_INDEXING": "false",
                            "NEXT_PUBLIC_PRIVACY_EMAIL": "", "NEXT_PUBLIC_CONTACT_EMAIL": "", "NEXT_PUBLIC_FOUNDER_LINKEDIN_URL": "",
                            "CAREIQ_LOCAL_REVIEW_DIST_DIR": ".next-local-review"})
    else:
        environment.update({"EXPO_PUBLIC_API_URL": "http://localhost:3100", "EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY": publishable,
                            "EXPO_NO_TELEMETRY": "1", "EXPO_NO_DOTENV": "1", "EXPO_OFFLINE": "1"})
    return environment


def app_command(name: str):
    directory = ROOT / APPS[name]["directory"]
    if name == "api":
        command = [str(directory / "node_modules/.bin/tsx"), "src/index.ts"]
    elif name in ("web", "marketing"):
        command = [str(directory / "node_modules/.bin/next"), "dev", "--webpack", "--hostname", "127.0.0.1", "--port", str(APPS[name]["port"])]
    else:
        command = [str(directory / "node_modules/.bin/expo"), "start", "--web", "--host", "localhost", "--port", "8082"]
    if not Path(command[0]).exists():
        raise ReviewError(f"{name} dependencies are not ready. Finish pnpm install before local:start.")
    return directory, command


def processes():
    path = STATE / "processes.json"
    return json.loads(path.read_text()) if path.exists() else {}


def save_processes(value):
    write_private(STATE / "processes.json", json.dumps(value, indent=2) + "\n")


def fingerprint(pid: int):
    result = subprocess.run(["/bin/ps", "-p", str(pid), "-o", "lstart=", "-o", "command="], text=True, capture_output=True)
    return result.stdout.strip() if result.returncode == 0 else None


def owned(name, record):
    if not record or record.get("app") != name or record.get("port") != APPS[name]["port"]:
        return False
    current = fingerprint(record["pid"])
    recorded = record.get("fingerprint", "")
    expected_command = f"{Path(__file__).resolve()} _serve {name} {record.get('token', '')}"
    try:
        # macOS Python may re-exec its framework executable after spawn. Compare the
        # exact managed script/arguments plus recorded start time, not that wrapper path.
        return (current is not None and current.split(maxsplit=5)[:5] == recorded.split(maxsplit=5)[:5]
                and current.endswith(expected_command) and recorded.endswith(expected_command)
                and os.getpgid(record["pid"]) == record["pid"])
    except ProcessLookupError:
        return False


def health(name):
    application = APPS[name]
    try:
        host = "localhost" if name == "mobile" else "127.0.0.1"
        # Expo's localhost mode may bind ::1. All probes stay on loopback and bypass proxies.
        with build_opener(ProxyHandler({})).open(f"http://{host}:{application['port']}{application['health']}", timeout=2) as response:
            if response.status != 200:
                return "warming"
            if name == "api" and json.loads(response.read(4096)).get("database") != "connected":
                return "unhealthy"
            return "ready"
    except Exception:
        return "warming"


def setup():
    check_node_runtime()
    ensure_database()
    migrate_databases()
    ensure_runtime()
    print("Isolated local databases and restricted review runtime are ready on 127.0.0.1:55434.", flush=True)


def start():
    check_node_runtime()
    records = processes()
    for name, application in APPS.items():
        if owned(name, records.get(name)):
            continue
        if occupied(application["port"]):
            raise ReviewError(f"Port {application['port']} is occupied by an unmanaged service; nothing was stopped or replaced.")
        app_command(name)
    test_clerk_configuration()
    setup()
    for name, application in APPS.items():
        if owned(name, records.get(name)):
            print(f"{name}: already running · {application['url']}", flush=True)
            continue
        log = STATE / f"{name}.log"
        descriptor = os.open(log, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
        token = secrets.token_hex(12)
        with os.fdopen(descriptor, "a") as stream:
            os.chmod(log, 0o600)
            process = subprocess.Popen([sys.executable, str(Path(__file__).resolve()), "_serve", name, token],
                                       cwd=ROOT, env=app_environment(name), stdin=subprocess.DEVNULL, stdout=stream, stderr=stream,
                                       start_new_session=True, close_fds=True)
        identity = None
        for _attempt in range(20):
            identity = fingerprint(process.pid)
            if identity and f"_serve {name} {token}" in identity:
                break
            time.sleep(0.05)
        if not identity:
            raise ReviewError(f"{name} supervisor did not start; inspect its private log.")
        records[name] = {"app": name, "port": application["port"], "pid": process.pid, "token": token, "fingerprint": identity,
                         "url": application["url"], "log": str(log), "startedAt": time.time()}
        save_processes(records)
        print(f"{name}: started · {application['url']}", flush=True)
    deadline = time.monotonic() + 45
    while time.monotonic() < deadline:
        stopped = [name for name in APPS if not owned(name, records.get(name))]
        if stopped:
            status()
            raise ReviewError(f"Startup failed: {', '.join(stopped)} supervisor stopped; inspect its private .local-review log. Other running applications were preserved.")
        if all(health(name) == "ready" for name in APPS):
            break
        time.sleep(0.5)
    result = status()
    unavailable = [name for name, application in result["applications"].items() if application["state"] != "ready"]
    if unavailable:
        raise ReviewError(f"Startup readiness failed: {', '.join(unavailable)}. Inspect the private .local-review logs and retry local:start. Other running applications were preserved.")


def status(as_json=False):
    records = processes()
    applications = {}
    for name, application in APPS.items():
        managed = owned(name, records.get(name))
        applications[name] = {"state": health(name) if managed else ("unmanaged port occupied" if occupied(application["port"]) else "stopped"),
                              "url": application["url"], "pid": records[name]["pid"] if managed else None,
                              "log": f".local-review/{name}.log"}
    try:
        database = inspect_database()
        db_state = "running" if database and database["State"]["Running"] else "stopped"
    except ReviewError:
        db_state = "unavailable or unmanaged"
    result = {"applications": applications, "database": {"state": db_state, "address": "127.0.0.1:55434", "volumePreserved": True},
              "nativeAuthenticationEnabled": False, "marketingIntakeEnabled": False}
    if as_json:
        print(json.dumps(result, indent=2))
    else:
        for name, application in applications.items():
            print(f"{name}: {application['state']} · {application['url']}")
        print(f"database: {db_state} · 127.0.0.1:55434 · volume preserved")
    return result


def stop():
    records = processes()
    for name, record in list(records.items()):
        if name not in APPS or not owned(name, record):
            print(f"{name}: no matching owned supervisor; no process was stopped.", flush=True)
            continue
        stop_application(name, record, records)
    save_processes(records)
    database = inspect_database()
    if database and database["State"]["Running"]:
        docker("stop", database["Id"])
    print("Review database stopped; its named data volume and private configuration were preserved.", flush=True)


def stop_application(name, record, records):
    if not owned(name, record):
        raise ReviewError(f"{name} has no matching owned supervisor; no process was stopped.")
    os.killpg(record["pid"], signal.SIGTERM)
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline and owned(name, record):
        time.sleep(0.1)
    if owned(name, record):
        os.killpg(record["pid"], signal.SIGKILL)
    records.pop(name, None)
    save_processes(records)
    print(f"{name}: stopped its matching owned process group.", flush=True)


def restart(name):
    check_node_runtime()
    if name not in APPS:
        raise ReviewError("Restart requires api, web, marketing or mobile.")
    # Reject a malformed private override before interrupting the healthy owned app.
    app_environment(name)
    records = processes()
    record = records.get(name)
    if owned(name, record):
        stop_application(name, record, records)
    elif occupied(APPS[name]["port"]):
        raise ReviewError("Restart target is occupied by an unmanaged service; no process was stopped.")
    start()


def serve(name: str):
    directory, command = app_command(name)
    child = subprocess.Popen(command, cwd=directory, stdin=subprocess.DEVNULL)
    stopping = False

    def terminate(_signal, _frame):
        nonlocal stopping
        if not stopping:
            stopping = True
            child.terminate()

    signal.signal(signal.SIGTERM, terminate)
    signal.signal(signal.SIGINT, terminate)
    return child.wait()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("setup", "start", "status", "stop", "restart", "_serve"))
    parser.add_argument("app", nargs="?", choices=tuple(APPS))
    parser.add_argument("token", nargs="?")
    parser.add_argument("--json", action="store_true")
    arguments = parser.parse_args()
    if arguments.action == "_serve":
        if not arguments.app or not arguments.token:
            raise ReviewError("A managed supervisor requires its application and ownership token.")
        return serve(arguments.app)
    private_state()
    descriptor = os.open(STATE / "control.lock", os.O_WRONLY | os.O_CREAT, 0o600)
    with os.fdopen(descriptor, "w") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise ReviewError("Another local review operation is active; try again when it finishes.")
        if arguments.action == "status":
            status(arguments.json)
        elif arguments.action == "restart":
            restart(arguments.app)
        else:
            {"setup": setup, "start": start, "stop": stop}[arguments.action]()
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (ReviewError, OSError, ValueError, KeyError) as error:
        print(redacted(f"Local review: {error}"), file=sys.stderr)
        raise SystemExit(1)
