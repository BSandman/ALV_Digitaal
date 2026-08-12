# Lokale Git-hooks

Activeer de repository-hooks één keer per lokale clone:

```sh
git config core.hooksPath .githooks
```

De pre-commit hook draait dezelfde dependency-vrije `handoff.md`-validator als CI. Een lokale bypass met `--no-verify` blijft mogelijk; de leidende CI-gate controleert iedere PR en iedere push naar `main` alsnog.
