# G-Touch NFC tag test: ready for the founder's hands (26 Oct 2026)

Everything is prepared except programming and placing the two physical tags. That needs you.

## Why this matters
A tap point **without a tag earns nothing**. `verify_kiosk_origin()`, which decides whether a ride earns the 1% lobby share, returns nothing at all when `kiosk_nodes.tag_uid` is empty. It never even reaches the location check. Today all 7 tap points have no tag.

## The two tags
| Tag | Tap point | Its link (write exactly this) | Status today |
|---|---|---|---|
| A | Xtra Foods Sangre Grande | `https://g-taxi-868-r1-admin.vercel.app/tap?node=9a9d6786-ef02-404c-bdf1-a927f43dba56` | Switched on. Tap page works (checked 26 Oct). **No map location** |
| B | KFC Sangre Grande | `https://g-taxi-868-r1-admin.vercel.app/tap?node=028a8a40-2514-4d91-a3c3-1d61f6f19238` | Has a map location. **Switched off**: the tap page says "touchpoint not active yet" |

- The links come from `system_config.nfc_tap_base_url` plus `?node=<tap point id>`. That's the same format the admin app writes.
- Want a different place for a tag? Use that tap point's ID; the format stays the same.

## Your steps (about 15 minutes, on site)
1. **Tags:** two blank NTAG213 or NTAG215 stickers.
2. **Write each link.** Use the admin phone app's Tag Marker screen, or any NFC writer app (NXP TagWriter is free). Write the link above as a **URL record**. Don't lock the tag yet.
3. **Read each tag's ID** (the "UID", like `04:A2:…`). Tag Marker or the writer app shows it.
4. **Attach the tag to its tap point** on the admin website, under Node Registry. For each tap point:
   - open it;
   - paste the tag ID;
   - make sure it's switched **Active**;
   - for Xtra Foods, set the map location while standing at the counter (Tag Marker's GPS capture, or the lat/lng fields);
   - press Save.

   Saving registers the tag and refuses a chip that's already someone's keychain.
5. **Put each tag in place.** Take a photo of each one.
6. **Tap test** with a normal phone: not the admin phone, logged out of G868. Tap tag A, then tag B. Each should:
   - open the G868 page showing **"Pickup set: <place>"**;
   - offer WhatsApp and the app.

   Tap the WhatsApp button once. That's the test booking intent: the message reads "I tapped in at "<place>" and would like to request a ride", with a map pin.
7. Tell me **"tags tapped"** and I'll run the check below.

## The check I run (pass/fail)
```sql
select location_name, tag_uid is not null as tag_attached, is_active,
       lat is not null as has_map_location, last_heartbeat,
       (select count(*) from identity_tags t where t.tag_uid = k.tag_uid and t.profile_id is null) as tag_registered_as_counter_tag
  from kiosk_nodes k
 where id in ('9a9d6786-ef02-404c-bdf1-a927f43dba56', '028a8a40-2514-4d91-a3c3-1d61f6f19238');
```
**PASS for each tag:**
- `tag_attached`, `is_active` and `has_map_location` are all true;
- `tag_registered_as_counter_tag` = 1;
- `last_heartbeat` matches the time you tapped. Each successful page load updates it. Baselines before the test: Xtra Foods 26 Oct 2026 23:49 UTC (that was my own link check, not a tag), KFC 17 Jul 2026.
- The WhatsApp message arrives at the support number, and I log it in WhatsApp Intake.

The full "tap → ride earns the lobby share" chain still needs a real completed ride from that tap point. That's the Phase 0 "20 real rides" gate, not this test.

## After it passes
- Lock each tag in the writer app (that's permanent), **but only once** `g-taxi-868-r1-admin.vercel.app` is the address you're keeping. Locked tags can never be changed.
