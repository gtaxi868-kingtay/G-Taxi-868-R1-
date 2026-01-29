-- Seed Data: Ghost Drivers (Port of Spain)
-- Adds drivers near the default app location (10.6549, -61.5019) so they are visible immediately

insert into public.drivers (name, vehicle_model, plate_number, rating, is_online, status, lat, lng, heading)
values 
('Michael Jordan', 'Toyota Axio', 'PDF 1111', 4.9, true, 'online', 10.6555, -61.5025, 45),
('Lisa Ray', 'Nissan Tiida', 'PDG 2222', 4.8, true, 'online', 10.6540, -61.5010, 180),
('Robert Grant', 'Hyundai Ioniq', 'PDH 3333', 5.0, true, 'online', 10.6560, -61.5030, 270),
('Emma Stone', 'Honda City', 'PDI 4444', 4.9, true, 'online', 10.6530, -61.5005, 90),
('James Bond', 'Aston Martin (Mock)', '007', 5.0, true, 'online', 10.6549, -61.5019, 0);
