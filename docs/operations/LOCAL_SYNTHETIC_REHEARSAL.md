# Local synthetic Gate C rehearsal

This rehearsal uses only the disposable `baseer-erp-postgres` test container and the test environment file. It never reads Noorix, production data, a live domain, or an external backup device.

Run it from the BASEER ERP workspace after the Gate B database verification has succeeded:

```powershell
.\scripts\Invoke-GateC-LocalRehearsal.ps1
```

The script creates a temporary custom PostgreSQL dump, restores it into a newly created PostgreSQL container with `--network none`, compares table and foundation record counts, verifies a non-superuser application role can authenticate, writes a non-secret receipt under `.rehearsal/gate-c`, and removes the restored container and temporary dump.

This is evidence of a local synthetic restore path only. It does not replace the remaining Gate C requirements: HTTPS on the chosen Hostinger private server, verified Hostinger daily-server-backup coverage, and an isolated restore rehearsal using the selected operational setup.
