# Security policy

## Supported versions

Security fixes are applied to the latest published minor line. The current
development line is `0.1.x`.

## Reporting a vulnerability

Do not open a public issue containing exploit details, credentials, private
source, or personal data. Use a private GitHub Security Advisory for
`specport/specport` when the repository supports it, or contact the maintainer
through the private repository channel. Include the affected version or
commit, a minimal reproduction, impact, and any safe mitigation.

SpecPort is local-first and does not upload repository content to a SpecPort
service. Reports should still describe any explicitly configured receiver,
model, network, credential, or deployment boundary involved in the issue.

The maintainer will acknowledge a report when practical, reproduce it in an
isolated fixture, and document the fixed version or mitigation before public
disclosure. Do not test against systems or data you do not own.
