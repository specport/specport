# SpecPort ship receipt

status: [BLOCKED/SHIPPABLE/SHIPPED]
run_id: [RUN-ID]

## Contract

- path: [PATH]
- id/version: [ID] / [VERSION]
- sha256: [DIGEST]
- accepted_by / accepted_at / decision_source: [OWNER]

## Repository and artifact

- remote: [REMOTE]
- base: [REF AND COMMIT]
- final_commit / final_tree_fingerprint: [IDENTITY]
- artifact name/version/path/checksum: [ARTIFACT]
- clean-consumer or target smoke: [RESULT]

## Gates

See the accompanying `gate-ledger.md`. Every required gate must be `PASS` or
explicitly owner-authorized `N/A` before this receipt can be `SHIPPABLE`.

## Acceptance and verification

- criteria-to-evidence map: [PATH]
- exact checks, exit codes, environments, and limitations: [PATH]
- taste-review record: [PATH]

## Rollback

- last known good ref/version/artifact: [KNOWN GOOD]
- recovery evidence: [PATH]
- residual risk and owner: [RISK / OWNER]

## Ship decision

- owner: [HUMAN OWNER]
- decision: [HOLD/APPROVE/PUBLISH/DEPLOY]
- external action: [NOT-RUN/VERIFIED WHERE AND HOW]
- recorded_at: [TIME]

Do not use `SHIPPED` unless the owner authorized the external action and an
independent observable confirms publication or deployment.
