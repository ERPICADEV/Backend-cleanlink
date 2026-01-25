import axios from 'axios';

export interface ReverseGeocodeResult {
  area_name?: string;
  address?: string;
  city?: string;
  state?: string;
  country?: string;
}

/**
 * Reverse geocode coordinates to address using OpenStreetMap Nominatim API
 * Free service, no API key required, but has rate limits
 */
export async function reverseGeocode(
  lat: number,
  lng: number
): Promise<ReverseGeocodeResult> {
  try {
    // Use Nominatim (OpenStreetMap) - free, no API key needed
    const response = await axios.get('https://nominatim.openstreetmap.org/reverse', {
      params: {
        lat,
        lon: lng,
        format: 'json',
        addressdetails: 1,
        zoom: 18, // Get detailed address
      },
      headers: {
        'User-Agent': 'CleanLink-Civic-Reporting-App/1.0', // Required by Nominatim
      },
      timeout: 5000,
    });

    const address = response.data.address || {};
    
    // Extract relevant fields - Nominatim structure varies by region
    return {
      area_name: address.neighbourhood || address.suburb || address.quarter || address.road,
      address: address.road || address.house_number 
        ? `${address.house_number || ''} ${address.road || ''}`.trim()
        : undefined,
      city: address.city || address.town || address.village || address.municipality,
      state: address.state || address.region || address.province,
      country: address.country || 'India', // Default to India if not found
    };
  } catch (error: any) {
    console.error('Reverse geocoding error:', error.message);
    // Return empty result on error - we'll still have lat/lng
    return {
      country: 'India', // Default fallback
    };
  }
}

