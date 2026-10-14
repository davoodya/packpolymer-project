# Connecting a WordPress Site to Claude Code

A practical, step-by-step guide to wiring a WordPress site into Claude Code so it can
read and manage content as first-class tools.

---

## 1. What "connecting" actually means

Claude Code talks to external services through an **MCP (Model Context Protocol) server** —
a small local process that exposes named *tools* (e.g. `wp_create_post`, `wp_list_media`).
You register the server once; after that Claude Code can call those tools directly instead
of you pasting API responses into chat.

The good news for WordPress: **no hack is required**. WordPress ships with a full REST API
(`/wp-json/wp/v2/...`) and, since **WordPress 5.6**, a built-in authentication mechanism
called **Application Passwords** that is designed exactly for this — machine-to-machine
access with credentials that can be scoped and revoked independently of your login password.

**The recommended stack:**

```
Claude Code  →  MCP server (local npx process)  →  WordPress REST API  →  your site
                     authenticates with an Application Password
```

No plugin needs to be installed on your site, and nothing is routed through a third-party
proxy — the MCP server runs on your own machine and talks to your site directly.

---

## 2. Prerequisites

| Requirement | Why | Check |
|---|---|---|
| WordPress **5.6+** (6.x recommended) | Application Passwords are built in | *Tools → Site Health → Info* |
| **HTTPS** on your site, **or** a local dev environment | App Passwords are blocked on plain-HTTP remote sites by default | `https://` in your site URL |
| An account with the role you need (Admin for full control; Editor for content only) | The MCP server can never do more than that account can | *Users → All Users* |
| **Node.js 18+** on this PC | Runs the MCP server via `npx` | `node --version` |
| Claude Code installed and working | Obvious, but confirm it runs before adding MCP | `claude --version` |
| `curl` available | Used to verify the connection before wiring up Claude Code | `curl --version` |

> **Plain HTTP caveat:** Application Passwords are only enabled by default when the site is
> served over SSL *or* `wp_get_environment_type()` returns `local`. To force them on for a
> remote non-HTTPS site (not recommended — credentials would travel in cleartext), add
> `add_filter( 'wp_is_application_passwords_available', '__return_true' );` to a
> must-use plugin. The real fix is HTTPS.

---

## 3. Create an Application Password

This password is *separate* from your normal login password and can be revoked with one
click. Use a dedicated one for Claude Code so you can kill it without disturbing anything else.

### From wp-admin

1. Log in as the WordPress user Claude Code will act as.
2. Go to **Users → Profile** (or **Users → All Users → Edit** for another user, if you're an admin).
3. Scroll to the **Application Passwords** section.
4. Enter a name — e.g. `claude-code-local` — and click **Add New Application Password**.
5. WordPress shows the password **once**, as groups of characters like
   `abcd EFGH 1234 ijkl MNOP 5678`. **Copy it immediately** — after you leave that screen
   it can never be shown again.

### Or via WP-CLI (if you have shell access to the server)

```bash
# Show only the password, ready to store
wp user application-password create <user-login-or-id> claude-code-local --porcelain
```

Example output:

```
ZG1bxdxdzjTwhsY8vK8l1C65
```

### Verify it works before going further

From this PC (Git Bash / any terminal):

```bash
curl -u "USERNAME:abcd EFGH 1234 ijkl MNOP 5678" \
  "https://your-site.com/wp-json/wp/v2/users/me"
```

You should get JSON describing the user, including their role. A `401` means the credentials
are wrong; a `404` means the REST API path isn't resolving (see troubleshooting, §8).

**Store the password somewhere safe now** — a password manager, not a chat log.

---

## 4. Pick an MCP server

There is no official Automattic/WordPress MCP server. The most mature community options,
based on how they connect:

| Server | Connection type | WP version | Best for | Maturity |
|---|---|---|---|---|
| **`mcp-wordpress`** (docdyhr/mcp-wordpress) | **REST API only** — no plugin | 5.6+ | The default choice: content, media, users, comments, categories, site settings | ★ Very mature, 71 tools, large test suite |
| **Novamira** (use-novamira/novamira) | Installs a **WordPress plugin** → executes PHP, WP-CLI, filesystem access | 6.9+, PHP 8.0+ | Deep work: debugging plugins, running `$wpdb` queries, WP-CLI | ★ Capable but higher risk — full server access |
| **Elementor MCP** (msrbuilds/elementor-mcp) | WordPress plugin | 6.x | Editing Elementor/Bricks page designs | ★ Good if you build pages visually |
| **WooCommerce MCP** (techspawn/woocommerce-mcp-server) | REST API | 5.6+ | Products, orders, customers on a store | ★ Newer |

**Recommendation: start with `mcp-wordpress`.** It is REST-only, needs no plugin, and is
limited by WordPress's own role system — so an Editor account can't take the site apart. If
you later need lower-level access (running PHP/WP-CLI from Claude Code), add Novamira on a
**dev or staging site only** — it effectively grants code execution on the server, and its
own documentation warns: *"For dev and staging environments. With backups. Always."*

---

## 5. Register the server in Claude Code

Make sure you're in the project where you want the server available — for this repo:

```bash
cd /h/Repo/packpolymer
```

### Option A — one command (recommended)

```bash
claude mcp add mcp-wordpress \
  --scope local \
  --env WORDPRESS_SITE_URL="https://your-site.com" \
  --env WORDPRESS_USERNAME="your-wp-username" \
  --env WORDPRESS_APP_PASSWORD="abcd EFGH 1234 ijkl MNOP 5678" \
  -- npx -y mcp-wordpress
```

Notes on that command:

- **`--scope local`** stores the config in your personal Claude settings for *this project*.
  That keeps the password **out of the repository** — important, because
  `H:\Repo\packpolymer\` may be committed and pushed somewhere.
- Use **`--scope project`** instead if you want the config shared via a checked-in
  `.mcp.json` — but then the file contains your password, so add `.mcp.json` to
  `.gitignore` first and don't share it publicly.
- Everything after the **`--`** is the command that starts the server.
- `npx -y mcp-wordpress` downloads and runs the published package each launch (cached after
  the first time); no global install needed.

### Option B — JSON file

Create `H:\Repo\packpolymer\.mcp.json`:

```json
{
  "mcpServers": {
    "mcp-wordpress": {
      "command": "npx",
      "args": ["-y", "mcp-wordpress"],
      "env": {
        "WORDPRESS_SITE_URL": "https://your-site.com",
        "WORDPRESS_USERNAME": "your-wp-username",
        "WORDPRESS_APP_PASSWORD": "abcd EFGH 1234 ijkl MNOP 5678"
      }
    }
  }
}
```

Claude Code will prompt for approval the first time it loads a project-scoped server.

### Windows gotcha

On Windows, `npx` is a `.cmd` shim and some Node versions fail to spawn it directly. If
`claude mcp list` shows the server failing to start, wrap it in `cmd`:

```bash
claude mcp add mcp-wordpress \
  --scope local \
  --env WORDPRESS_SITE_URL="https://your-site.com" \
  --env WORDPRESS_USERNAME="your-wp-username" \
  --env WORDPRESS_APP_PASSWORD="abcd EFGH 1234 ijkl MNOP 5678" \
  -- cmd /c npx -y mcp-wordpress
```

(the JSON equivalent is `"command": "cmd", "args": ["/c", "npx", "-y", "mcp-wordpress"]`).

---

## 6. Verify the connection

```bash
claude mcp list          # is the server registered and reaching Claude Code?
claude mcp get mcp-wordpress   # show its config and tool count
```

Then, inside Claude Code in this project, run the **`/mcp`** command — it shows live status
for every configured server. Once it shows `mcp-wordpress` as connected, try:

> List the 5 most recent posts on my WordPress site.

Claude Code should now be able to call `wp_list_posts` (or the equivalent tool name) and
show real content from your site.

---

## 7. What you can do once connected

With `mcp-wordpress` registered, you can ask Claude Code in plain language to:

- **Content** — "Draft a post about X from these notes, then publish it as a draft"
- **Bulk editing** — "Find all posts tagged 'legacy' and add a note at the top"
- **Media** — "Upload the banner image in this folder and attach it to post 42"
- **Taxonomy cleanup** — "List categories with fewer than 3 posts and merge these two"
- **Comments** — "Show me the 10 most recent comments awaiting moderation"
- **Site overview** — "Summarize my site's settings and user list"
- **Editing flow** — "Take this markdown file, convert it to blocks, and publish it."

Anything the connected WordPress **role** can't do, the MCP server can't do either — which
is exactly the safety property you want.

---

## 8. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `401 Unauthorized` from curl or the server | Wrong username/password, or you pasted the password from a place that dropped characters | Generate a **new** Application Password and retry; the old one is never shown again |
| `403 Forbidden` or empty response | Security plugin / WAF blocking REST API or Basic Auth | Whitelist the REST endpoint and your IP in Wordfence/Sucuri/etc.; some plugins require explicitly allowing Application Passwords |
| `404` on `/wp-json/...` | Permalinks set to "Plain", or the site is in a subfolder | Site is still reachable via `?rest_route=/wp/v2/posts`. In wp-admin, **Settings → Permalinks → Save** to regenerate rewrite rules |
| Server entry exists but tools never appear | `npx` failed to spawn (Windows `.cmd` issue) | Use the `cmd /c npx ...` form from §5 |
| Connection works over LAN but not from this PC | Corporate proxy / firewall | Set `HTTPS_PROXY` for the MCP process via an extra `--env HTTPS_PROXY=...` |
| Everything worked yesterday, now 401 | Someone revoked the password, or it was regenerated | Create a new one, update the env var with `claude mcp remove mcp-wordpress` + re-add |
| Tools visible but "permission denied" on writes | The WordPress user's role lacks the capability | Use an Administrator for site management, or an Editor for content-only work |
| Slow first response | First `npx` run downloads the package | Subsequent launches use the npm cache; or `npm install -g mcp-wordpress` and point the command at the installed binary |

---

## 9. Security checklist — read before connecting a production site

1. **Use HTTPS.** Application Passwords use HTTP Basic Auth, so anyone who can read the
   traffic can read the password. Non-HTTPS remote sites refuse them by default for this
   reason — don't override that filter on a production site.
2. **One password per purpose.** Name it after the machine and tool
   (`claude-code-laptop`), so you know exactly what to revoke if it leaks.
3. **Least-privileged role.** If Claude Code will only write content, connect it as an
   **Editor**, not an Administrator. Role is the real permission boundary.
4. **Don't commit credentials.** Keep the config in `--scope local` (personal settings), or
   `.gitignore` the `.mcp.json` file. Never paste the password into a prompt, a commit
   message, or a bug report.
5. **Know that Application Passwords bypass two-factor authentication** — that is by design
   (2FA protects interactive logins). It's another reason to keep them revocable and minimal.
6. **Backups before bulk operations.** Before asking Claude Code to delete posts, rewrite
   batches of pages, or change settings, confirm you have a recent backup. Deletions through
   the REST API go straight to the database.
7. **Prefer REST-only servers for production.** A server that can execute PHP or WP-CLI
   (Novamira) is a full code-execution path into your server — fine on dev/staging, a
   serious risk on live.
8. **Audit occasionally.** *Users → Profile → Application Passwords* shows every app password
   with its last-used date. Revoke anything you don't recognize.

---

## 10. Alternatives worth knowing

- **You already have a "good enough" connection: Bash.** Claude Code can run `curl` against
  the REST API and, if your host provides it, `wp` over SSH. The MCP server just makes those
  calls structured, discoverable, and stateful — worth it for regular work, overkill for a
  one-off query.
- **Local dev site?** If WordPress runs on this machine (e.g. under `H:\` or a Local/DevKinsta
  install), Claude Code can read the theme/plugin files *directly with its file tools* and
  run `wp` locally — often more useful than any MCP server, since it can edit code and
  content in one session.

---

*Last reviewed: October 2026. Package names, tool counts, and env variables may change —
check the server's own README (`github.com/docdyhr/mcp-wordpress`) if a command misbehaves.*
