/**
 * Maneja la funcionalidad del menú móvil
 * Este script es utilizado por HeaderNonSticky.astro y MobileNav.astro
 */

export function initMobileMenu() {
  const openButton = document.getElementById('mobile-menu-toggle');
  const closeButton = document.getElementById('mobile-menu-close');
  const mobileMenu = document.getElementById('mobile-menu');

  if (!mobileMenu) return;

  function openMenu() {
    mobileMenu.style.display = 'flex';
    mobileMenu.classList.remove('hidden');
    mobileMenu.style.flexDirection = 'column';
    document.body.style.overflow = 'hidden';
    mobileMenu.setAttribute('aria-hidden', 'false');

    requestAnimationFrame(() => {
      mobileMenu.classList.remove('opacity-0', '-translate-y-4');
      mobileMenu.classList.add('opacity-100', 'translate-y-0');
    });

    document.addEventListener('keydown', handleEscapeKey);
  }

  function closeMenu() {
    mobileMenu.classList.add('opacity-0', '-translate-y-4');
    mobileMenu.classList.remove('opacity-100', 'translate-y-0');
    mobileMenu.setAttribute('aria-hidden', 'true');

    setTimeout(() => {
      mobileMenu.style.display = 'none';
      mobileMenu.classList.add('hidden');
      document.body.style.overflow = '';
    }, 300);

    document.removeEventListener('keydown', handleEscapeKey);
  }

  function handleEscapeKey(e) {
    if (e.key === 'Escape') {
      closeMenu();
    }
  }

  if (openButton) {
    openButton.addEventListener('click', openMenu);
  }

  if (closeButton) {
    closeButton.addEventListener('click', closeMenu);
  }
}
