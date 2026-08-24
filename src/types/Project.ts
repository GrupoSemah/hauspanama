/**
 * Interfaz para la estructura de cada proyecto inmobiliario
 */
export interface Project {
  id: string;
  name: string;
  logo: string;
  logo2: string;
  propertyType: string;
  location: string;
  address: string;
  slogan: string;
  description: string;
  size: string;
  bedrooms: string;
  bathrooms: string;
  price: string;
  coverImage: string;
  heroVideo: string;
  brochureFile: string;
  videoFile: string;
  buttonText: string;
  pipedriveFormUrl: string;
  features: Feature[];
  gallery: string[];
  videoThumbnail: string;
  mapImage: string;
  mapsUrl: string;
  /** CRM alterno usado para captura de leads (ej. 'zoho' en vez de Pipedrive) */
  crm?: string;
  /** URL de destino del form cuando crm es 'zoho' */
  zohoFormAction?: string;
  /** Canal de captura alterno: si es 'whatsapp', el form redirige a WhatsApp en vez de al CRM */
  leadChannel?: 'whatsapp';
}

/**
 * Interfaz para las características/amenidades de cada proyecto
 */
export interface Feature {
  icon: string;
  text: string;
}

/**
 * Interfaz para las tarjetas de propiedades en la página principal
 */
export interface PropertyCard {
  id: string;
  title: string;
  title2: string;
  subtitle: string;
  link: string;
  image: string;
}
