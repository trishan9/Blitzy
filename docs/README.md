# Guides

Start with **[FINAL-DEMO-SCRIPT.md](FINAL-DEMO-SCRIPT.md)**. It is the recording itself, in order,
with every action, every payload and every spoken line. Ten minutes.

| Guide | What it is for |
|---|---|
| [FINAL-DEMO-SCRIPT.md](FINAL-DEMO-SCRIPT.md) | **the script.** Postman, Burp, the monitoring stack, the pipeline |
| [DEMO-ROUTES.md](DEMO-ROUTES.md) | every address and every port, with what to click and what should be there |
| [BURP-GUIDE.md](BURP-GUIDE.md) | the deeper reference, one section per vulnerability class |
| [PENTEST-GUIDE.md](PENTEST-GUIDE.md) | the methodology behind the testing |
| [STACK-GUIDE.md](STACK-GUIDE.md) | what every container and module is for, and where it listens |
| [SECURITY-DECISIONS.md](SECURITY-DECISIONS.md) | why each control was built the way it was |

## Scripts

| Script | What it does |
|---|---|
| `scripts/up.sh` | starts everything, waits, repairs what a volume reset breaks, prints every port and its status |
| `scripts/demo-data.sh` | real traffic so the graphs have a shape |
| `scripts/demo-security-events.sh` | one real attack of every kind the Wazuh rules watch for |
| `scripts/burp-requests.sh` | raw Burp requests with live cookies, tokens and ids filled in |

## archive/

Superseded guides, kept in case something in them is still wanted. Nothing points at them.
Delete with `rm -rf docs/archive` when you are sure.
