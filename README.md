# D&D Recovery

Command-line audit of demurrage and detention invoices. Rules and types live in `dd-core`. Model calls live only in `dd-extract`. The `dd` command will live in `dd-cli`.

Customer files stay outside this repository.

## Commands

```sh
pnpm install
pnpm lint
pnpm typecheck
pnpm test
```

`make lint`, `make typecheck`, and `make test` run the same three checks.
