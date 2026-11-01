-- Who can approve what on a partner campaign. Run after the migration, inside
-- a transaction: every path raises on failure and the last line always raises,
-- so nothing here can stick.

CREATE OR REPLACE FUNCTION pg_temp.act_as(p_user uuid) RETURNS void LANGUAGE sql AS $$
    SELECT set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;

CREATE OR REPLACE FUNCTION pg_temp.refused(p_sql text) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN
    EXECUTE p_sql;
    RETURN false;
EXCEPTION WHEN OTHERS THEN
    RETURN true;
END;
$$;

DO $test$
DECLARE
    v_m uuid; v_owner uuid; v_m2 uuid; v_owner2 uuid; v_admin uuid; v_rider uuid;
    c1 uuid; c2 uuid; c3 uuid; c4 uuid; n int; log text := '';
    save text;
BEGIN
    SELECT id, created_by INTO v_m, v_owner FROM public.merchants WHERE created_by IS NOT NULL ORDER BY id LIMIT 1;
    SELECT id, created_by INTO v_m2, v_owner2 FROM public.merchants WHERE created_by IS NOT NULL AND created_by <> v_owner ORDER BY id LIMIT 1;
    SELECT id INTO v_admin FROM public.profiles WHERE role::text = 'admin' LIMIT 1;
    SELECT id INTO v_rider FROM public.profiles WHERE role::text = 'rider' AND id NOT IN (SELECT created_by FROM public.merchants WHERE created_by IS NOT NULL) LIMIT 1;
    ASSERT v_m IS NOT NULL AND v_m2 IS NOT NULL AND v_admin IS NOT NULL AND v_rider IS NOT NULL, 'fixtures missing';
    UPDATE public.merchants SET is_active = true, activation_status = 'active' WHERE id = v_m;
    save := format('SELECT public.partner_campaign_save(%L, ''Full shop, ride home'')', v_m);

    PERFORM pg_temp.act_as(v_rider);
    ASSERT pg_temp.refused(save), 'a rider must not draft for a business';
    PERFORM pg_temp.act_as(v_owner2);
    ASSERT pg_temp.refused(save), 'another owner must not draft for this business';

    PERFORM pg_temp.act_as(v_admin);
    c1 := (public.partner_campaign_save(v_m, 'Full shop, ride home', 'Free bag help', NULL, '#22D3EE', 'everyone')->>'id')::uuid;
    ASSERT (SELECT status FROM public.partner_campaigns WHERE id = c1) = 'awaiting_business', 'G 868 draft waits for the business';
    ASSERT pg_temp.refused(format('SELECT public.partner_campaign_decide(%L, ''approve'')', c1)), 'the author must not approve their own draft';
    PERFORM pg_temp.act_as(v_owner2);
    ASSERT pg_temp.refused(format('SELECT public.partner_campaign_decide(%L, ''approve'')', c1)), 'another owner must not approve';

    PERFORM pg_temp.act_as(v_rider);
    SELECT count(*) INTO n FROM public.partner_offers_for_rider(ARRAY[v_m]);
    ASSERT n = 0, 'a rider must not see an unapproved offer';

    PERFORM pg_temp.act_as(v_owner);
    PERFORM public.partner_campaign_decide(c1, 'approve');
    PERFORM pg_temp.act_as(v_rider);
    SELECT count(*) INTO n FROM public.partner_offers_for_rider(ARRAY[v_m]);
    ASSERT n = 1, 'an approved offer shows on the pin';
    log := log || 'approve ok; ';

    PERFORM pg_temp.act_as(v_owner);
    ASSERT pg_temp.refused(format('SELECT public.partner_campaign_save(%L, ''Sneaky'', p_campaign_id => %L)', v_m, c1)), 'live must not be edited in place';

    PERFORM public.partner_campaign_decide(c1, 'pause');
    PERFORM pg_temp.act_as(v_rider);
    SELECT count(*) INTO n FROM public.partner_offers_for_rider(ARRAY[v_m]);
    ASSERT n = 0, 'a paused offer leaves the pin';
    PERFORM pg_temp.act_as(v_admin);
    ASSERT pg_temp.refused(format('SELECT public.partner_campaign_decide(%L, ''resume'')', c1)), 'G 868 must not override an owner pause';
    PERFORM pg_temp.act_as(v_owner);
    PERFORM public.partner_campaign_decide(c1, 'resume');
    log := log || 'pause ok; ';

    c2 := (public.partner_campaign_save(v_m, 'New package', 'Two for one')->>'id')::uuid;
    ASSERT (SELECT status FROM public.partner_campaigns WHERE id = c2) = 'awaiting_g868', 'a business edit waits for G 868';
    ASSERT pg_temp.refused(format('SELECT public.partner_campaign_decide(%L, ''approve'')', c2)), 'the business must not approve its own edit';
    PERFORM pg_temp.act_as(v_admin);
    ASSERT pg_temp.refused(format('SELECT public.partner_campaign_decide(%L, ''request_changes'')', c2)), 'sending back needs a note';
    PERFORM public.partner_campaign_decide(c2, 'approve');
    ASSERT (SELECT status FROM public.partner_campaigns WHERE id = c1) = 'ended', 'the old version ends';
    SELECT count(*) INTO n FROM public.partner_campaigns WHERE merchant_id = v_m AND status = 'live';
    ASSERT n = 1, 'only one live version per business';
    log := log || 'swap ok; ';

    c3 := (public.partner_campaign_save(v_m, 'Said yes on WhatsApp')->>'id')::uuid;
    ASSERT pg_temp.refused(format('SELECT public.partner_campaign_decide(%L, ''approve_on_behalf'', ''ok'')', c3)), 'on-behalf needs a real note';
    PERFORM pg_temp.act_as(v_owner);
    ASSERT pg_temp.refused(format('SELECT public.partner_campaign_decide(%L, ''approve_on_behalf'', ''owner said yes in person'')', c3)), 'only G 868 records on-behalf';
    PERFORM pg_temp.act_as(v_admin);
    PERFORM public.partner_campaign_decide(c3, 'approve_on_behalf', 'Owner said yes on WhatsApp 1 Nov');
    ASSERT (SELECT change_note FROM public.partner_campaigns WHERE id = c3) LIKE 'Owner said yes%', 'the approval note is kept';
    log := log || 'behalf ok; ';

    c4 := (public.partner_campaign_save(v_m, 'Clients only', NULL, NULL, '#8B5CF6', 'my_clients')->>'id')::uuid;
    PERFORM public.partner_campaign_decide(c4, 'approve_on_behalf', 'Owner said yes on WhatsApp 1 Nov');
    PERFORM pg_temp.act_as(v_rider);
    SELECT count(*) INTO n FROM public.partner_offers_for_rider(ARRAY[v_m]);
    ASSERT n = 0, 'a my_clients offer is hidden from a stranger';
    UPDATE public.partner_campaigns SET audience = 'everyone', ends_on = current_date - 2, starts_on = current_date - 5 WHERE id = c4;
    SELECT count(*) INTO n FROM public.partner_offers_for_rider(ARRAY[v_m]);
    ASSERT n = 0, 'an expired offer leaves the pin';
    log := log || 'audience+dates ok; ';

    PERFORM pg_temp.act_as(v_admin);
    ASSERT pg_temp.refused(format('SELECT public.partner_campaign_save(%L, ''Bad colour'', p_accent_color => ''red'')', v_m)), 'bad colour refused';
    ASSERT pg_temp.refused(format('SELECT public.partner_campaign_save(%L, ''Bad image'', p_image_url => ''http://x.tt/a.png'')', v_m)), 'non-https image refused';

    ASSERT NOT has_table_privilege('authenticated', 'public.partner_campaigns', 'UPDATE'), 'no direct update';
    ASSERT NOT has_table_privilege('authenticated', 'public.partner_campaigns', 'INSERT'), 'no direct insert';
    ASSERT NOT has_table_privilege('anon', 'public.partner_campaigns', 'SELECT'), 'anon reads nothing';
    ASSERT NOT has_function_privilege('anon', 'public.partner_offers_for_rider(uuid[])', 'EXECUTE'), 'anon has no offers';
    ASSERT NOT has_function_privilege('authenticated', 'public.partner_campaign_side(uuid)', 'EXECUTE'), 'side helper stays internal';

    RAISE EXCEPTION 'ALL PASSED (rolled back): %', log;
END;
$test$;
