# MHRA Manufacturer Enrichment

## Status
Pending manual enrichment — 44 unique manufacturer IDs to resolve.

## Process
1. Go to https://pard.mhra.gov.uk
2. Search by device name or GMDN term to find the device
3. Note the manufacturer name shown
4. Update `device_master` in Supabase:
   ```sql
   UPDATE device_master
   SET manufacturer_name = 'Actual Manufacturer Name'
   WHERE manufacturer_name = 'MHRA Manufacturer {ID}';
   ```
   Or if multiple devices share the same ID:
   ```sql
   UPDATE device_master
   SET manufacturer_name = 'Actual Manufacturer Name'
   WHERE device_id IN ('MHRA-XXXXX', 'MHRA-XXXXX');
   ```

## Notes
- PARD's API returns `MAN_ORGANISATION_ID` in device records but not the name
- `searchManufacturers` endpoint requires a name string — no lookup-by-ID available
- Manufacturer names added manually should be verified against the PARD website
- When manufacturer enrichment API support is added, this file should be updated

## TODO: Audit Trail
- Supabase does not currently have audit logging enabled for `device_master`
- Before enabling manufacturer updates at scale, consider adding:
  - `updated_by` column (text — user email or 'system')
  - `updated_at` column (timestamptz)
  - Or enable Supabase's built-in audit logging via pg_audit extension
- See: https://supabase.com/docs/guides/database/extensions/pgaudit

## Manufacturer ID to Device Mapping

| Org ID | Device IDs | Status |
|--------|-----------|--------|
| 104299 | MHRA-215538 | ⬜ Pending |
| 105282 | MHRA-156143 | ⬜ Pending |
| 105363 | MHRA-170563 | ⬜ Pending |
| 108356 | MHRA-195616 | ⬜ Pending |
| 110764 | MHRA-169275 | ⬜ Pending |
| 112284 | MHRA-173747 | ⬜ Pending |
| 11469  | MHRA-176768, MHRA-214142 | ⬜ Pending |
| 115736 | MHRA-200106 | ⬜ Pending |
| 116327 | MHRA-184346 | ⬜ Pending |
| 117499 | MHRA-188818 | ⬜ Pending |
| 122847 | MHRA-235745 | ⬜ Pending |
| 124973 | MHRA-232259 | ⬜ Pending |
| 126411 | MHRA-213590 | ⬜ Pending |
| 128607 | MHRA-221060 | ⬜ Pending |
| 132483 | MHRA-232793 | ⬜ Pending |
| 13597  | MHRA-22298 | ⬜ Pending |
| 13769  | MHRA-214302 | ⬜ Pending |
| 15508  | MHRA-189423 | ⬜ Pending |
| 15890  | MHRA-157821 | ⬜ Pending |
| 19040  | MHRA-72650 | ⬜ Pending |
| 19486  | MHRA-142681, MHRA-214883 | ⬜ Pending |
| 20451  | MHRA-48805 | ⬜ Pending |
| 20555  | MHRA-200888, MHRA-64356 | ⬜ Pending |
| 29011  | MHRA-133017 | ⬜ Pending |
| 31107  | MHRA-166261 | ⬜ Pending |
| 31522  | MHRA-220511 | ⬜ Pending |
| 31544  | MHRA-70173 | ⬜ Pending |
| 31640  | MHRA-224774 | ⬜ Pending |
| 31934  | MHRA-163877 | ⬜ Pending |
| 32649  | MHRA-237599 | ⬜ Pending |
| 33064  | MHRA-82008 | ⬜ Pending |
| 33643  | MHRA-81236 | ⬜ Pending |
| 34291  | MHRA-186828 | ⬜ Pending |
| 34527  | MHRA-139827, MHRA-231108 | ⬜ Pending |
| 34704  | MHRA-232039 | ⬜ Pending |
| 34772  | MHRA-235840 | ⬜ Pending |
| 34839  | MHRA-101783 | ⬜ Pending |
| 34988  | MHRA-100812 | ⬜ Pending |
| 36709  | MHRA-84082 | ⬜ Pending |
| 37201  | MHRA-202379 | ⬜ Pending |
| 38068  | MHRA-221235 | ⬜ Pending |
| 38655  | MHRA-88291 | ⬜ Pending |
| 38657  | MHRA-146109, MHRA-170543, MHRA-88296, MHRA-88308 | ⬜ Pending |
| 39031  | MHRA-154880 | ⬜ Pending |
| 40395  | MHRA-152750 | ⬜ Pending |
| 42806  | MHRA-100750 | ⬜ Pending |
| 45354  | MHRA-106969 | ⬜ Pending |
| 47158  | MHRA-206776 | ⬜ Pending |
| 47924  | MHRA-205849 | ⬜ Pending |
| 50535  | MHRA-174280 | ⬜ Pending |
| 59122  | MHRA-146699 | ⬜ Pending |
