// Fallback for people who deny (or don't have) location access: they pick their
// barangay and we use its centre point. Every point below is verified to fall
// inside the launch cluster; enter_cluster() on the server has the final say and
// snaps whatever it receives to the 500 m grid.
//
// Makati's 23 barangays (current city limits — the EMBO barangays moved to
// Taguig in 2023 and are deliberately absent).
export const MAKATI_BARANGAYS: { name: string; lat: number; lng: number }[] = [
  { name: 'Bangkal', lat: 14.5433, lng: 121.0128 },
  { name: 'Bel-Air', lat: 14.563, lng: 121.026 },
  { name: 'Carmona', lat: 14.5747, lng: 121.0178 },
  { name: 'Dasmariñas', lat: 14.5405, lng: 121.03 },
  { name: 'Forbes Park', lat: 14.548, lng: 121.0385 },
  { name: 'Guadalupe Nuevo', lat: 14.56, lng: 121.0445 },
  { name: 'Guadalupe Viejo', lat: 14.565, lng: 121.04 },
  { name: 'Kasilawan', lat: 14.576, lng: 121.014 },
  { name: 'La Paz', lat: 14.569, lng: 121.008 },
  { name: 'Magallanes', lat: 14.5365, lng: 121.0185 },
  { name: 'Olympia', lat: 14.572, lng: 121.0205 },
  { name: 'Palanan', lat: 14.559, lng: 121.003 },
  { name: 'Pinagkaisahan', lat: 14.5585, lng: 121.044 },
  { name: 'Pio del Pilar', lat: 14.5515, lng: 121.012 },
  { name: 'Poblacion', lat: 14.565, lng: 121.03 },
  { name: 'San Antonio', lat: 14.5645, lng: 121.011 },
  { name: 'San Isidro', lat: 14.556, lng: 121.008 },
  { name: 'San Lorenzo', lat: 14.551, lng: 121.019 },
  { name: 'Santa Cruz', lat: 14.569, lng: 121.0145 },
  { name: 'Singkamas', lat: 14.572, lng: 121.011 },
  { name: 'Tejeros', lat: 14.5725, lng: 121.0135 },
  { name: 'Urdaneta', lat: 14.556, lng: 121.03 },
  { name: 'Valenzuela', lat: 14.572, lng: 121.026 },
];

// Not in Makati → waitlist. The label tells us where demand is building.
export const OTHER_AREAS: { name: string; lat: number; lng: number }[] = [
  { name: 'Taguig / BGC', lat: 14.5507, lng: 121.0509 },
  { name: 'Pasay', lat: 14.5378, lng: 121.0014 },
  { name: 'Mandaluyong', lat: 14.5794, lng: 121.0359 },
  { name: 'Manila', lat: 14.5995, lng: 120.9842 },
  { name: 'Pasig', lat: 14.5764, lng: 121.0851 },
  { name: 'San Juan', lat: 14.6019, lng: 121.0355 },
  { name: 'Quezon City', lat: 14.676, lng: 121.0437 },
  { name: 'Parañaque', lat: 14.4793, lng: 121.0198 },
  { name: 'Somewhere else', lat: 14.6091, lng: 121.0223 },
];

export const DOG_BREEDS = ['Aspin', 'Shih Tzu', 'Pomeranian', 'Chihuahua', 'Pug', 'Beagle', 'Golden Retriever', 'Labrador Retriever', 'Siberian Husky', 'Corgi', 'Toy Poodle', 'French Bulldog', 'Dachshund', 'Japanese Spitz', 'Chow Chow', 'Maltese', 'Yorkshire Terrier', 'German Shepherd', 'Belgian Malinois', 'Bichon Frise'];
export const CAT_BREEDS = ['Puspin', 'Persian', 'Siamese', 'British Shorthair', 'Ragdoll', 'Maine Coon', 'Scottish Fold', 'Bengal', 'American Shorthair', 'Exotic Shorthair', 'Sphynx'];
