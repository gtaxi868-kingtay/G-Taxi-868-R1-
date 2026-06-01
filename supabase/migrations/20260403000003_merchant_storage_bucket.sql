-- Create storage bucket for merchant intake photos
INSERT INTO storage.buckets (id, name, public) 
VALUES ('merchant-intake-photos', 'merchant-intake-photos', true)
ON CONFLICT (id) DO NOTHING;

-- Storage policies for the bucket
DROP POLICY IF EXISTS "Public Access for Intake Photos" ON storage.objects;
CREATE POLICY "Public Access for Intake Photos" ON storage.objects FOR SELECT
USING (bucket_id = 'merchant-intake-photos');

DROP POLICY IF EXISTS "Merchants can upload intake photos" ON storage.objects;
CREATE POLICY "Merchants can upload intake photos" ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'merchant-intake-photos');
