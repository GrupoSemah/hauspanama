/**
 * Interfaces para componentes específicos de la aplicación
 */

/**
 * Propiedades para el componente de carrusel de imágenes
 */
export interface ImageCarouselProps {
  images: string[];
  publicIds: string[];
  altText?: string;
}

/**
 * Propiedades para el modal de mapa
 */
export interface MapModalProps {
  mapImage: string;
  mapsUrl?: string;
  projectName?: string;
}

/**
 * Propiedades para el formulario de contacto
 */
export interface ContactFormProps {
  formUrl: string;
}

/**
 * Propiedades para LocalImage
 */
export interface LocalImageProps {
  src: string;
  alt: string;
  className?: string;
  width?: number;
  height?: number;
  loading?: 'eager' | 'lazy';
  sizes?: string;
  fetchPriority?: 'high' | 'low' | 'auto';
}

/**
 * Propiedades para LocalVideo
 */
export interface LocalVideoProps {
  videoSrc: string;
  thumbnailPath: string;
  altText?: string;
  className?: string;
}
