# ADR 0003: AWS hosting options and monthly planning ranges

**Status:** superseded; decision remains open; provision/spend/deploy = none.

The former `us-east-1` options are replaced by the reconciled `eu-north-1` PostgreSQL comparison:

- [`../AWS-HOSTING-OPTIONS-R1-WAVE0-20260925.md`](../AWS-HOSTING-OPTIONS-R1-WAVE0-20260925.md)

That document is the sole hosting-options source for this decision. It includes the cheapest pilot positioned for the RPO ≤5 min / RTO ≤4 h gate only, managed-database choices, process separation, S3 quarantine/artifact/evidence prefixes, five-minute RPO design, unmeasured-versus-achieved RTO reporting, isolation controls, and monthly line items.

No option is selected by this ADR. A later decision must name the chosen option, approved monthly ceiling, achieved recovery evidence, and separately authorized provisioning/deployment scope.
