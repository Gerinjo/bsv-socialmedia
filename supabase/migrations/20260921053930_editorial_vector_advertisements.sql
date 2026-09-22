-- Only the server selects reviewed SVGs whose source upload hash still matches.
-- The bucket remains private; published artwork is never overwritten.
update storage.buckets set allowed_mime_types=array['image/png','image/svg+xml']
where id='editorial-advertisements';
