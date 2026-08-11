#!/usr/bin/env bash
set -euo pipefail

HOST="${1:-client.bestpvp.eu}"
ROOT="/var/www/${HOST}"
PORT="${BC_DB_PORT:-3306}"

if [ "$(id -u)" -ne 0 ]; then
    echo "Run this as root, for example with sudo." >&2
    exit 1
fi

: "${BC_DB_HOST:?set BC_DB_HOST=... in front of the command}"
: "${BC_DB_NAME:?set BC_DB_NAME=... in front of the command}"
: "${BC_DB_USER:?set BC_DB_USER=... in front of the command}"
: "${BC_DB_PASS:?set BC_DB_PASS=... in front of the command}"

echo "==> installing nginx, php and certbot"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq nginx php-fpm php-cli php-mysql php-curl certbot python3-certbot-nginx curl >/dev/null

echo "==> opening the web ports"
if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | head -1 | grep -qi active; then
    ufw allow 80/tcp >/dev/null || true
    ufw allow 443/tcp >/dev/null || true
    echo "    ufw: 80 and 443 allowed"
fi
if command -v iptables >/dev/null 2>&1; then
    iptables -C INPUT -p tcp --dport 80 -j ACCEPT 2>/dev/null || iptables -I INPUT -p tcp --dport 80 -j ACCEPT || true
    iptables -C INPUT -p tcp --dport 443 -j ACCEPT 2>/dev/null || iptables -I INPUT -p tcp --dport 443 -j ACCEPT || true
    echo "    iptables: 80 and 443 accepted"
fi

echo "==> writing the service to ${ROOT}"
mkdir -p "${ROOT}"

cat > "${ROOT}/index.php" <<'BESTCLIENT_INDEX_PHP'
<?php

declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');

const SESSION_DAYS = 30;
const ONLINE_SECONDS = 90;
const CHALLENGE_SECONDS = 120;
const MAX_FRIENDS = 200;

function fail(int $status, string $message): never
{
    http_response_code($status);
    echo json_encode(['error' => $message], JSON_UNESCAPED_SLASHES);
    exit;
}

function done(array $payload): never
{
    echo json_encode($payload, JSON_UNESCAPED_SLASHES);
    exit;
}

function db(): PDO
{
    static $pdo = null;

    if ($pdo instanceof PDO) {
        return $pdo;
    }

    $file = __DIR__ . '/config.php';

    if (!is_file($file)) {
        fail(500, 'The server is not configured yet.');
    }

    $config = require $file;

    try {
        $pdo = new PDO(
            sprintf('mysql:host=%s;port=%d;dbname=%s;charset=utf8mb4', $config['host'], $config['port'], $config['name']),
            $config['user'],
            $config['pass'],
            [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_EMULATE_PREPARES => false],
        );
    } catch (PDOException $error) {
        fail(503, 'The database is not reachable.');
    }

    return $pdo;
}

function body(): array
{
    $raw = file_get_contents('php://input');

    if ($raw === false || $raw === '') {
        return [];
    }

    $parsed = json_decode($raw, true);

    return is_array($parsed) ? $parsed : [];
}

function text(array $source, string $key, int $limit): string
{
    $value = $source[$key] ?? '';

    return is_string($value) ? substr(trim($value), 0, $limit) : '';
}

function isUuid(string $value): bool
{
    return preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/', strtolower($value)) === 1;
}

function isName(string $value): bool
{
    return preg_match('/^[A-Za-z0-9_]{3,16}$/', $value) === 1;
}

function dashed(string $plain): string
{
    return strtolower(
        substr($plain, 0, 8) . '-' . substr($plain, 8, 4) . '-' . substr($plain, 12, 4)
        . '-' . substr($plain, 16, 4) . '-' . substr($plain, 20, 12),
    );
}

function get(string $url): ?array
{
    $context = stream_context_create(['http' => ['timeout' => 8, 'ignore_errors' => true]]);
    $raw = @file_get_contents($url, false, $context);

    if ($raw === false || $raw === '') {
        return null;
    }

    $parsed = json_decode($raw, true);

    return is_array($parsed) ? $parsed : null;
}

function caller(): array
{
    $header = $_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '';

    if (stripos($header, 'Bearer ') !== 0) {
        fail(401, 'Sign in first.');
    }

    $token = substr($header, 7);

    if (!preg_match('/^[0-9a-f]{64}$/', $token)) {
        fail(401, 'Sign in first.');
    }

    $statement = db()->prepare(
        'SELECT s.uuid, p.name FROM bc_session s JOIN bc_player p ON p.uuid = s.uuid'
        . ' WHERE s.token = ? AND s.expires > NOW()',
    );
    $statement->execute([$token]);
    $row = $statement->fetch(PDO::FETCH_ASSOC);

    if ($row === false) {
        fail(401, 'That sign in has run out.');
    }

    return $row;
}

function touch_player(string $uuid, string $name, string $server): void
{
    $statement = db()->prepare(
        'INSERT INTO bc_player (uuid, name, first_seen, last_seen, server)'
        . ' VALUES (?, ?, NOW(), NOW(), ?)'
        . ' ON DUPLICATE KEY UPDATE name = VALUES(name), last_seen = NOW(), server = VALUES(server)',
    );
    $statement->execute([$uuid, $name, $server]);
}

function seen(string $uuid): void
{
    db()->prepare('UPDATE bc_player SET last_seen = NOW() WHERE uuid = ?')->execute([$uuid]);
}

function befriend(string $one, string $other): void
{
    $insert = db()->prepare('INSERT IGNORE INTO bc_friend (uuid, friend, created) VALUES (?, ?, NOW())');
    $insert->execute([$one, $other]);
    $insert->execute([$other, $one]);

    $clear = db()->prepare('DELETE FROM bc_request WHERE (uuid = ? AND target = ?) OR (uuid = ? AND target = ?)');
    $clear->execute([$one, $other, $other, $one]);
}

$action = $_GET['a'] ?? '';

if ($action === 'health') {
    db();
    done(['ok' => true]);
}

if ($action === 'auth-begin') {
    $uuid = strtolower(text(body(), 'uuid', 36));

    if (!isUuid($uuid)) {
        fail(400, 'That is not a player id.');
    }

    $serverId = bin2hex(random_bytes(20));

    $statement = db()->prepare('INSERT INTO bc_challenge (server_id, uuid, created) VALUES (?, ?, NOW())');
    $statement->execute([$serverId, $uuid]);

    db()->prepare('DELETE FROM bc_challenge WHERE created < DATE_SUB(NOW(), INTERVAL ? SECOND)')
        ->execute([CHALLENGE_SECONDS]);

    done(['serverId' => $serverId]);
}

if ($action === 'auth-finish') {
    $input = body();
    $serverId = text($input, 'serverId', 40);
    $name = text($input, 'name', 16);

    if (!preg_match('/^[0-9a-f]{40}$/', $serverId) || !isName($name)) {
        fail(400, 'That sign in was not started here.');
    }

    $statement = db()->prepare(
        'SELECT uuid FROM bc_challenge WHERE server_id = ? AND created > DATE_SUB(NOW(), INTERVAL ? SECOND)',
    );
    $statement->execute([$serverId, CHALLENGE_SECONDS]);
    $claimed = $statement->fetchColumn();

    if ($claimed === false) {
        fail(400, 'That sign in was not started here.');
    }

    $profile = get(sprintf(
        'https://sessionserver.mojang.com/session/minecraft/hasJoined?username=%s&serverId=%s',
        rawurlencode($name),
        rawurlencode($serverId),
    ));

    if ($profile === null || !isset($profile['id'], $profile['name'])) {
        fail(403, 'Mojang did not confirm that account.');
    }

    $verified = dashed((string) $profile['id']);

    if ($verified !== strtolower((string) $claimed)) {
        fail(403, 'That account does not match the one that started the sign in.');
    }

    db()->prepare('DELETE FROM bc_challenge WHERE server_id = ?')->execute([$serverId]);

    touch_player($verified, (string) $profile['name'], '');

    $token = bin2hex(random_bytes(32));

    $statement = db()->prepare(
        'INSERT INTO bc_session (token, uuid, issued, expires) VALUES (?, ?, NOW(), DATE_ADD(NOW(), INTERVAL ? DAY))',
    );
    $statement->execute([$token, $verified, SESSION_DAYS]);

    db()->prepare('DELETE FROM bc_session WHERE expires < NOW()')->execute();

    done(['token' => $token, 'uuid' => $verified, 'name' => (string) $profile['name']]);
}

$me = caller();

if ($action === 'presence') {
    $server = strtolower(text(body(), 'server', 96));

    touch_player($me['uuid'], $me['name'], $server);

    if ($server === '') {
        done(['players' => []]);
    }

    $statement = db()->prepare(
        'SELECT uuid FROM bc_player WHERE server = ? AND last_seen > DATE_SUB(NOW(), INTERVAL ? SECOND)',
    );
    $statement->execute([$server, ONLINE_SECONDS]);

    done(['players' => $statement->fetchAll(PDO::FETCH_COLUMN)]);
}

if ($action === 'friends') {
    seen($me['uuid']);

    $statement = db()->prepare(
        'SELECT p.uuid, p.name, p.server, p.last_seen > DATE_SUB(NOW(), INTERVAL ? SECOND) AS online'
        . ' FROM bc_friend f JOIN bc_player p ON p.uuid = f.friend'
        . ' WHERE f.uuid = ? ORDER BY online DESC, p.name ASC',
    );
    $statement->execute([ONLINE_SECONDS, $me['uuid']]);
    $friends = $statement->fetchAll(PDO::FETCH_ASSOC);

    $statement = db()->prepare(
        'SELECT p.uuid, p.name FROM bc_request r JOIN bc_player p ON p.uuid = r.uuid'
        . ' WHERE r.target = ? ORDER BY r.created DESC',
    );
    $statement->execute([$me['uuid']]);
    $incoming = $statement->fetchAll(PDO::FETCH_ASSOC);

    $statement = db()->prepare(
        'SELECT p.uuid, p.name FROM bc_request r JOIN bc_player p ON p.uuid = r.target'
        . ' WHERE r.uuid = ? ORDER BY r.created DESC',
    );
    $statement->execute([$me['uuid']]);
    $outgoing = $statement->fetchAll(PDO::FETCH_ASSOC);

    done([
        'me' => ['uuid' => $me['uuid'], 'name' => $me['name']],
        'friends' => array_map(static fn (array $row): array => [
            'uuid' => $row['uuid'],
            'name' => $row['name'],
            'server' => $row['server'],
            'online' => (bool) $row['online'],
        ], $friends),
        'incoming' => $incoming,
        'outgoing' => $outgoing,
    ]);
}

if ($action === 'add') {
    $name = text(body(), 'name', 16);

    if (!isName($name)) {
        fail(400, 'That is not a Minecraft name.');
    }

    $statement = db()->prepare('SELECT uuid, name FROM bc_player WHERE name = ?');
    $statement->execute([$name]);
    $target = $statement->fetch(PDO::FETCH_ASSOC);

    if ($target === false) {
        fail(404, $name . ' has not opened BestClient yet.');
    }

    if ($target['uuid'] === $me['uuid']) {
        fail(400, 'That is you.');
    }

    $statement = db()->prepare('SELECT COUNT(*) FROM bc_friend WHERE uuid = ?');
    $statement->execute([$me['uuid']]);

    if ((int) $statement->fetchColumn() >= MAX_FRIENDS) {
        fail(409, 'Your friend list is full.');
    }

    $statement = db()->prepare('SELECT 1 FROM bc_friend WHERE uuid = ? AND friend = ?');
    $statement->execute([$me['uuid'], $target['uuid']]);

    if ($statement->fetchColumn() !== false) {
        done(['state' => 'friends', 'name' => $target['name']]);
    }

    $statement = db()->prepare('SELECT 1 FROM bc_request WHERE uuid = ? AND target = ?');
    $statement->execute([$target['uuid'], $me['uuid']]);

    if ($statement->fetchColumn() !== false) {
        befriend($me['uuid'], $target['uuid']);
        done(['state' => 'friends', 'name' => $target['name']]);
    }

    $statement = db()->prepare(
        'INSERT IGNORE INTO bc_request (uuid, target, created) VALUES (?, ?, NOW())',
    );
    $statement->execute([$me['uuid'], $target['uuid']]);

    done(['state' => 'asked', 'name' => $target['name']]);
}

if ($action === 'accept') {
    $uuid = strtolower(text(body(), 'uuid', 36));

    if (!isUuid($uuid)) {
        fail(400, 'That is not a player id.');
    }

    $statement = db()->prepare('SELECT 1 FROM bc_request WHERE uuid = ? AND target = ?');
    $statement->execute([$uuid, $me['uuid']]);

    if ($statement->fetchColumn() === false) {
        fail(404, 'That request is gone.');
    }

    befriend($me['uuid'], $uuid);
    done(['state' => 'friends']);
}

if ($action === 'remove') {
    $uuid = strtolower(text(body(), 'uuid', 36));

    if (!isUuid($uuid)) {
        fail(400, 'That is not a player id.');
    }

    db()->prepare('DELETE FROM bc_friend WHERE (uuid = ? AND friend = ?) OR (uuid = ? AND friend = ?)')
        ->execute([$me['uuid'], $uuid, $uuid, $me['uuid']]);

    db()->prepare('DELETE FROM bc_request WHERE (uuid = ? AND target = ?) OR (uuid = ? AND target = ?)')
        ->execute([$me['uuid'], $uuid, $uuid, $me['uuid']]);

    done(['state' => 'gone']);
}

fail(404, 'No such call.');
BESTCLIENT_INDEX_PHP

umask 027
BC_DB_PORT="${PORT}" php -r '$c = ["host" => getenv("BC_DB_HOST"), "port" => (int) (getenv("BC_DB_PORT") ?: 3306), "name" => getenv("BC_DB_NAME"), "user" => getenv("BC_DB_USER"), "pass" => getenv("BC_DB_PASS")]; file_put_contents($argv[1], "<?php\nreturn " . var_export($c, true) . ";\n");' "${ROOT}/config.php"

chown -R www-data:www-data "${ROOT}"
chmod 640 "${ROOT}/config.php"

SOCKET="$(ls /run/php/php*-fpm.sock 2>/dev/null | head -1 || true)"
if [ -z "${SOCKET}" ]; then
    echo "No php-fpm socket found under /run/php." >&2
    exit 1
fi

echo "==> writing the nginx site, leaving every other site alone"
cat > "/etc/nginx/sites-available/${HOST}" <<NGINX
server {
    listen 80;
    listen [::]:80;
    server_name ${HOST};
    root ${ROOT};
    index index.php;

    location / { try_files \$uri /index.php\$is_args\$args; }

    location ~ \.php\$ {
        include snippets/fastcgi-php.conf;
        fastcgi_pass unix:${SOCKET};
    }

    location ~ /config\.php { deny all; return 404; }
}
NGINX

ln -sf "/etc/nginx/sites-available/${HOST}" "/etc/nginx/sites-enabled/${HOST}"
nginx -t
systemctl reload nginx

echo "==> checking the service on the machine itself"
sleep 1
if curl -fsS "http://127.0.0.1/?a=health" -H "Host: ${HOST}"; then
    echo " <- the service answers locally"
else
    echo " <- the service did not answer locally. The database details in ${ROOT}/config.php are the usual cause."
fi

echo
echo "==> asking Let's Encrypt for a certificate"
certbot --nginx -d "${HOST}" --non-interactive --agree-tos --register-unsafely-without-email --redirect \
    || echo "certbot did not finish. The site still answers on http. Fix the DNS or the firewall, then run: certbot --nginx -d ${HOST}"

echo
echo "Done. From your own computer this should print {\"ok\":true}:"
echo "    curl https://${HOST}/?a=health"
