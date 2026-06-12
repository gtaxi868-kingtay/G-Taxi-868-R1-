ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS avg_rating NUMERIC(3,2) DEFAULT 0;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS total_ratings INTEGER DEFAULT 0;

CREATE OR REPLACE FUNCTION public.compute_avg_rating()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE public.profiles
    SET avg_rating = (
        SELECT COALESCE(ROUND(AVG(rating)::numeric, 2), 0)
        FROM public.ratings
        WHERE driver_id = NEW.driver_id
    ),
    total_ratings = (
        SELECT COUNT(*)
        FROM public.ratings
        WHERE driver_id = NEW.driver_id
    )
    WHERE id = NEW.driver_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_compute_avg_rating ON public.ratings;
CREATE TRIGGER trg_compute_avg_rating
    AFTER INSERT OR UPDATE OR DELETE ON public.ratings
    FOR EACH ROW
    EXECUTE FUNCTION public.compute_avg_rating();
