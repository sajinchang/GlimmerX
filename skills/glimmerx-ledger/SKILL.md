# GlimmerX ledger

A local, single-user double-entry ledger. You record and read the user's own
transactions through an MCP server on loopback.

**Protocol:** this server speaks **only** MCP `2026-07-28`. It does not open with
`initialize`, and it rejects older clients. Every request must carry
`MCP-Protocol-Version: 2026-07-28` plus the standard `Mcp-Method` /
`Mcp-Name` routing headers.

**Auth:** static bearer token, configured by the user
(`Authorization: Bearer <token>`). There is no OAuth discovery.

## Conventions

- **Amounts are integer cents.** `1850` is ¥18.50. Never send a decimal string,
  never send a float, never do rounding on your side.
- **Dates are `YYYY-MM-DD`.** Omit to mean today (the user's local date).
- **Accounts are addressed by name**, and names live in a tree written with
  slashes: `Assets/招商银行`, `Liabilities/花呗`, `Expenses/餐饮`.
  A bare last segment (`招商银行`) is accepted when it is unambiguous; when two
  accounts share a leaf name the call fails rather than guessing.
- **Categories are P&L only** (expense / income). A transfer has no category.
- One tool call writes **one** transaction.

## Reading first

Unknown ids are not errors you should recover from by guessing — they are
mistakes. Before writing:

1. `list_accounts` — get the exact names you are about to use.
2. `list_categories` — same for categories.
3. `ledger_status` — confirm the ledger is unlocked, and read the trust tier.

If the ledger reports `databaseLocked`, stop and tell the user to unlock
GlimmerX. Retrying will not help.

## Tools

| Tool | Use it for |
| --- | --- |
| `ledger_status` | Lock state, database path, current trust tier, today's date |
| `list_accounts` | Account names, types, paths, balances |
| `list_categories` | Expense / income categories |
| `query_transactions` | Paged search by date range, account, category, keyword |
| `get_balances` | Balances only (cheaper than `list_accounts` when that is all you need) |
| `summary` | Income / expense / net for a date range |
| `record_transaction` | Book one expense, income or transfer |
| `create_account` | Create an account (**usually denied**, see below) |

Resources are also available, and are cheaper than the equivalent tool call when
you only need a snapshot:

- `glimmerx://accounts`
- `glimmerx://categories`
- `glimmerx://report/{YYYY-MM}` (template)

## Writing

`record_transaction` takes:

```json
{
  "kind": "expense | income | transfer",
  "amount_cents": 1850,
  "date": "2026-11-14",
  "description": "lunch",
  "source_account": "Assets/微信",
  "destination_account": "Expenses/餐饮",
  "category": "餐饮",
  "idempotency_key": "any-stable-string"
}
```

- `kind: expense` — money leaves `source_account`; `category` is required
  (or inferred from the destination account name).
- `kind: income` — money arrives in `destination_account`.
- `kind: transfer` — both accounts required, both balance-sheet
  (asset / liability). No category.

### Retries: always pass `idempotency_key`

The ledger is a real book; booking the same lunch twice is a bug the user has to
find and fix by hand. If a call may be retried — timeouts, a transport error, an
agent restart — pass the **same** `idempotency_key` on the retry. The first
successful call's result is replayed verbatim and nothing new is written.

- One key per logical write. A genuinely new write needs a new key.
- Without a key there is no protection: two calls book two transactions.
- `"still being processed"` means the earlier call has not finished. Wait and
  retry with the same key; do not drop the key to "get it through".

### Trust tiers

| Tier | `record_transaction` |
| --- | --- |
| `readonly` (default) | refuses; tell the user to raise it in GlimmerX settings |
| `trust` | writes immediately |

There is no confirmation prompt in this server. Under `trust`, the user's
recourse is the undo button in GlimmerX, so **do not batch up writes**: record
one thing at a time and report what you did, or the user loses the thread of
what to undo.

### `create_account` is gated separately

Account creation is off by default and stays off unless the user enables it.
When it is off the call is denied — do **not** work around it by recording to a
guessed account. Ask the user to create the account, or to enable the switch.

When it is allowed, `path` follows the same slash rules
(`Assets/支付宝`); the root segment decides the type.

## Red lines

- Never invent an account id or path. Read the list, then use a name from it.
- Never split one real-world event into several `record_transaction` calls.
- Never re-record something because a retry "felt" uncertain — check
  `query_transactions` first, then retry with the same key.
- Never record a transfer as an expense just because the category is missing.
- Never claim success without a `transactionId` in the response.

## Error handling

| Response | Meaning | What to do |
| --- | --- | --- |
| `read-only` | trust tier is `readonly` | tell the user; do not retry |
| `databaseLocked` | GlimmerX is locked | tell the user to unlock; do not retry |
| `still being processed` | same key is mid-write | wait, retry with the same key |
| account / category not found | a name was wrong or duplicated | `list_*`, then retry with an exact name |
| `expected readonly or trust` | config was edited to something else | tell the user; do not retry |
| validation error (amount, date, transfer rules) | the request itself is wrong | fix the arguments, then retry |
