# Why we were "Chasing Symptoms"

We've been fixing 404s, 505s, and crashes one by one. The **cause** isn't the code—it's **Architectural Drift**.

### The Cause: Server-Side Gap
In a ride-hailing app, the **Database** is not just for storage; it is the **State Engine**. 
1.  **Code Expectation**: The Rider app assumes the server knows how to "Expire a ride" or "Calculate a wallet balance".
2.  **Reality**: Because our database sync (`db push`) was failing, your Supabase was "hollow"—it had the tables but not the **Logic (RPCs)**.
3.  **Result**: Every time the app tried to do something smart (like matching a driver), it hit a brick wall.

### How Uber Solved This
Uber doesn't rely on the mobile app to manage the ride. They use a **Central Dispatch Engine**:
- **Atomic Transactions**: A ride is only matched if the driver is *verified* as available at the exact microsecond of the request.
- **Server-Side Expiration**: If the rider's phone dies, the server still knows the ride is stale and cancels it automatically.

### The Fix: Platform Reconstruction
Instead of patching individual errors, we are going to **Re-reconstruct the Platform Foundation**.
1.  **Master SQL**: I've provided a script that installs the "Brain" (RPCs) into your Supabase database.
2.  **Bot Drivers**: I'm adding "Bots" into your database so the matching engine has "fuel" to work with even when you don't have a second phone online.
3.  **Clean Dependencies**: I'm standardizing the monorepo dependencies to stop the "Unable to resolve" errors.

**Action**: Run [MASTER_FIX_ROOT_CAUSE.sql](file:///Users/kingtay/Desktop/g%20taxi%20rider/MASTER_FIX_ROOT_CAUSE.sql) in your Supabase SQL Editor now.
