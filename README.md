# Edge Lab committed-history backup

Full Git bundle of local commit `c06070aed64f8b1d86f9e0da084969ca83b6d046` (378 commits), including automatic inactive verification and validation artifacts. This archive branch is not a deployment branch. Uncommitted workspace files are intentionally excluded.

SHA-256: `0f17bd23302180bed6fc080e5720f94159f77e1fa3efc4edb63721f0f5bcc06f`

Recovery in a new directory:

```sh
git clone edge-lab-c06070a-full.bundle recovered-edge-lab
cd recovered-edge-lab
git switch -c recovered-private-accounts
git rev-parse HEAD
git rev-parse HEAD^{tree}
```

Expected HEAD: `c06070aed64f8b1d86f9e0da084969ca83b6d046`
Expected tree: `df050f9f585d4b8493be6c06a6aff3dbafd6c7da`

Created through the authenticated GitHub integration because the Windows sandbox cannot access Credential Manager. No credentials were exported or changed. The full bundle has no prerequisite commits. Production API remains on master; hosted collector version 33 is independent.
