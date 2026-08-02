# SpecPort taste review

status: PASS | FAIL | BLOCKED | N/A
run_id: <same run id as gate-ledger and ship receipt>
reviewer: <named human reviewer>
reviewed_at: <ISO-8601 timestamp>
decision_source: <ticket, signed note, meeting record, or other durable source>

## Candidate identity

- repository: <path and remote>
- final commit/tree fingerprint: <exact identity>
- artifact name/version/checksum: <exact release candidate>
- contract id/version/digest: <exact accepted contract>
- user job exercised: <the real task the product promises>
- environment/device/viewport/fixture: <where the review happened>

## Rubric

| Criterion | PASS / CONCERN / N/A | Concrete observation | Evidence | Follow-up owner |
| --- | --- | --- | --- | --- |
| The primary user job is understandable without coaching |  |  |  |  |
| The result is useful and complete for the stated workflow |  |  |  |  |
| Interaction, visual quality, writing, audio, or operations fit the product medium |  |  |  |  |
| Error, empty, loading, and recovery states are understandable |  |  |  |  |
| Accessibility and privacy expectations in the contract are respected |  |  |  |  |
| The product feels mature enough for the declared release boundary |  |  |  |  |

## Evidence

- screenshots, recording, listening notes, traces, logs, or operational exercise:
  <paths or links>
- steps performed:
  <exact user actions and important inputs>
- defects or concerns:
  <severity, reproduction, and owner; write `none` explicitly when applicable>
- what this review does not prove:
  <security, scale, compatibility, or other limits not exercised>

## Decision

- decision: accept | reject | accept-with-explicit-exception
- residual risk: <named risk or `none`>
- next action: <exact owner action or `none`>
- ship authority: <human owner who may make the final release decision>

`PASS` requires concrete observations tied to the candidate identity and every
required rubric item. A screenshot, automated test, or agent opinion alone is
not a taste approval. `N/A` requires an explicit owner-authorized reason.
