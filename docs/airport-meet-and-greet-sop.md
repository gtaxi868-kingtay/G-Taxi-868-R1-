# Airport meet-and-greet: standard operating procedure (draft, 26 Oct 2026)

For a **hotel-booked, prepaid or monthly-invoiced** pickup at Piarco (POS), with a Tobago (TAB) variant.
Document only. Review it against the Connection Map phases before any airport work is scheduled.

**Status of facts used here:**
- **Confirmed in our system:** how the booking, timing and flight tracking work. That code is live and was tested on 26 Oct.
- **From the founder's Connection Map, not yet confirmed by me:**
  - Piarco's official taxis run from a dispatcher at the Ground Transportation Center (GTC);
  - hotel shuttles use pre-arranged pickups there;
  - ride-hail is listed as unavailable at Piarco.
- **Confirm before the first live pickup:** where a pre-booked G868 driver may legally wait, and whether a permit or fee applies. Ask the Airports Authority of Trinidad and Tobago (AATT) in writing.

## 1. Before the day
1. The hotel books the pickup under Airport Pickups in its G868 business account. It gives:
   - the guest's name (for the sign);
   - the guest's WhatsApp number;
   - the flight number and date;
   - the airport;
   - child seat or wheelchair needs, if any.
2. The guest gets a WhatsApp message with:
   - the meeting point;
   - the approximate time;
   - a 4-digit pickup PIN;
   - a note that the driver follows the flight.

   This needs a working WhatsApp sender. Until the token is fixed, the hotel passes the PIN on itself.
3. **Timing:**
   - the pickup is set to landing time plus **45 minutes** for international flights (immigration and bags), or **15 minutes** for Trinidad–Tobago flights;
   - while FlightAware is on, the system rechecks the flight every 10 minutes and moves the pickup if the arrival moves by 5 minutes or more;
   - with tracking off, the hotel enters the landing time and must watch the flight itself.
4. **Matching the vehicle to the request:**
   - child seat requested: only a driver who confirms they have one may accept;
   - wheelchair requested: only a wheelchair-accessible vehicle (none is registered yet; see the gaps at the end).

## 2. Driver positioning (Piarco)
1. Arrive at the **permitted pre-booked pickup area at the GTC** (location to be confirmed with AATT). **Never** wait or pick up at the taxi rank or the kerb lanes reserved for licensed airport taxis.
2. Be in position **by the pickup time shown in the driver app**. That time already includes the clearance buffer.
3. Hold a printed or on-screen **name sign**: the guest's name as booked, plus "G868". Never show the guest's phone number or the hotel's internal booking details.
4. Wear driver ID. The guest checks the plate against their trip message before getting in.

## 3. Meeting the guest
1. Ask for the **4-digit PIN** before loading bags. No PIN, no ride: call the hotel instead.
2. Confirm the destination is the booking hotel.
3. Start the trip in the driver app, so tracking, SOS and the trip record are all on.

## 4. Flight changes
| Situation | What the system does | What people do |
|---|---|---|
| Delayed or early by 5+ minutes | Moves the pickup time automatically | The driver follows the new time in the app |
| Early, inside the clearance buffer | The pickup is still landing + buffer, so the time is unchanged | Nothing |
| Cancelled | Marks the booking "Flight cancelled: call your guest". The ride is **not** cancelled automatically | The hotel calls the guest and rebooks or cancels |
| Diverted | Marks it "Flight diverted: call your guest" | The hotel decides. The driver is not sent |
| Tracking data stale (not refreshed for 30+ minutes before pickup) | Flags it "flight data out of date" (see the flight hardening notes) | The driver checks the arrivals board or calls the hotel before going |

## 5. Guest no-show
1. The driver waits until **pickup time + 30 minutes**. In that time they:
   - WhatsApp or call the guest twice;
   - then call the hotel.
2. If the guest still can't be reached, the driver records "guest no-show" in the app. The hotel sees it on its dashboard.
3. **Fee rule (founder to decide):** a waiting or no-show fee billed to the hotel, or none. Today no fee is charged; the existing cancellation rules apply.

## 6. Payment
- **Monthly-invoiced hotels:** nothing is collected from the guest. The fare goes on the hotel's monthly invoice, and the hotel's credit limit was checked at booking.
- **Other hotels:** the guest pays the driver in cash, at the fare shown at booking. There's no US-dollar card option yet; see the payments options report.

## 7. Tobago variant (ANR Robinson, TAB)
- Smaller terminal: the meeting point is the arrivals hall exit (to be confirmed with the AATT Tobago office).
- Trinidad–Tobago flights use the 15-minute buffer; international flights into TAB use 45.
- At peak times there may be few drivers in Tobago. A hotel booking a TAB pickup should do it at least **24 hours** ahead until enough drivers are working there.

## 8. Gaps before this can run for real
1. Written confirmation from AATT of the permitted pre-booked pickup area, for both airports.
2. The FlightAware key, so pickups follow flights. **Founder.**
3. A working WhatsApp sender, so guests get the PIN automatically.
4. At least one vehicle flagged wheelchair-accessible, and drivers confirmed to carry child seats.
5. A 24-hour support rota on the support WhatsApp number.
6. A visitor US-dollar card rail (payments report).
