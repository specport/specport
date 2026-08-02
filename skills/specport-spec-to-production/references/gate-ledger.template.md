# SpecPort gate ledger

run_id: [RUN-ID]
contract: [PATH]
contract_sha256: [SHA-256]
repository: [ROOT]
base_commit: [COMMIT]
candidate_commit: [COMMIT]

| Gate | Status | Owner | Evidence | Identity | Recorded at | Next action |
| --- | --- | --- | --- | --- | --- | --- |
| G0 contract and authority | [PASS/BLOCKED/NOT-RUN/N/A] | [OWNER] | [PATH] | [DIGEST] | [TIME] | [ACTION] |
| G1 traceability and plan | [PASS/BLOCKED/NOT-RUN/N/A] | [OWNER] | [PATH] | [COMMIT] | [TIME] | [ACTION] |
| G2 bounded implementation | [PASS/BLOCKED/NOT-RUN/N/A] | [OWNER] | [PATH] | [COMMIT] | [TIME] | [ACTION] |
| G3 final-candidate verification | [PASS/BLOCKED/NOT-RUN/N/A] | [OWNER] | [PATH] | [TREE] | [TIME] | [ACTION] |
| G4 final-tree coverage | [PASS/BLOCKED/NOT-RUN/N/A] | [OWNER] | [PATH] | [FINGERPRINT] | [TIME] | [ACTION] |
| G5 taste and product-quality review | [PASS/BLOCKED/NOT-RUN/N/A] | [REVIEWER] | [PATH] | [ARTIFACT/TREE] | [TIME] | [ACTION] |
| G6 release artifact and smoke | [PASS/BLOCKED/NOT-RUN/N/A] | [OWNER] | [PATH] | [CHECKSUM] | [TIME] | [ACTION] |
| G7 rollback and recovery | [PASS/BLOCKED/NOT-RUN/N/A] | [OWNER] | [PATH] | [REF/ARTIFACT] | [TIME] | [ACTION] |
| G8 ship receipt and decision | [PASS/BLOCKED/NOT-RUN/N/A] | [OWNER] | [PATH] | [RECEIPT] | [TIME] | [ACTION] |

Status rules: `PASS` requires current evidence for that gate; `BLOCKED` names
the exact resume condition; `NOT-RUN` is not a pass; `N/A` requires explicit
owner authorization and a reason. A downstream gate is stale when an upstream
contract, tree, artifact, or taste decision changes.
