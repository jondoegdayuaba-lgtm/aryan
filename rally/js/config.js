// Tuning that you might want to tweak lives here.

export const GAME_TITLE = ['RIDGE', 'RALLY'];
export const TAGLINE = 'Flat out on gravel through the lake forests. Fly the crests, nail the hairpins, beat your ghost.';

// Lighting presets. Angles in degrees; azimuth 0 = +z, 90 = +x.
export const TIMES = {
  morning: {
    name: 'Misty morning',
    sunElevation: 9, sunAzimuth: 118,
    turbidity: 5, rayleigh: 2.4, mie: 0.006, mieG: 0.86, skyExposure: 1.0,
    sunColor: '#ffd8ae', sunIntensity: 2.5,
    fogColor: '#a9b8c6', fogSunColor: '#ffd9b3', fogDensity: 0.0042, fogFalloff: 0.05, haze: 0.00018,
    clouds: 0.22, cloudLit: '#fff0dc', cloudShade: '#8795a6',
    groundColor: '#1b2013', envIntensity: 1.0, exposure: 1.0,
  },
  noon: {
    name: 'Midday sun',
    sunElevation: 52, sunAzimuth: 200,
    turbidity: 3.2, rayleigh: 1.5, mie: 0.004, mieG: 0.8, skyExposure: 0.95,
    sunColor: '#fff4e3', sunIntensity: 3.3,
    fogColor: '#a7b9cf', fogSunColor: '#f4efe4', fogDensity: 0.0012, fogFalloff: 0.02, haze: 0.00012,
    clouds: 0.36, cloudLit: '#ffffff', cloudShade: '#98a4b3',
    groundColor: '#20261a', envIntensity: 0.9, exposure: 0.95,
  },
  sunset: {
    name: 'Golden hour',
    sunElevation: 4.5, sunAzimuth: 292,
    turbidity: 6.5, rayleigh: 2.8, mie: 0.01, mieG: 0.9, skyExposure: 1.05,
    sunColor: '#ffb066', sunIntensity: 2.3,
    fogColor: '#a9958f', fogSunColor: '#f2b27a', fogDensity: 0.0015, fogFalloff: 0.03, haze: 0.00014,
    clouds: 0.42, cloudLit: '#ffc88f', cloudShade: '#6d5f72', cloudDark: 0.8,
    groundColor: '#1d1712', envIntensity: 1.0, exposure: 1.05,
  },
  night: {
    name: 'Night stage',
    night: true,
    sunElevation: -25, sunAzimuth: 200, moonElevation: 34, moonAzimuth: 150,
    turbidity: 3, rayleigh: 1.5, mie: 0.004, mieG: 0.8, skyExposure: 1,
    sunColor: '#9fb4ff', sunIntensity: 1.1,
    fogColor: '#101a2b', fogSunColor: '#1c2840', fogDensity: 0.0018, fogFalloff: 0.03, haze: 0.0001,
    clouds: 0.18, cloudLit: '#39445a', cloudShade: '#111724',
    groundColor: '#06080b', envIntensity: 8, exposure: 1.45,
  },
};

// Graphics tiers. `auto` picks one from the device.
export const QUALITY = {
  low:    { pixelRatio: 0.75, shadowMap: 1024, textureSize: 256, grass: 0,     treeRange: 320, bloom: false, msaa: 0 },
  medium: { pixelRatio: 1,    shadowMap: 2048, textureSize: 512, grass: 14000, treeRange: 560, bloom: true,  msaa: 2 },
  high:   { pixelRatio: 1.5,  shadowMap: 4096, textureSize: 1024, grass: 34000, treeRange: 820, bloom: true, msaa: 4 },
};
