import {
  LightboxOpenAnimation,
  ImageSwitchAnimation,
  SlideshowAnimation,
  FullscreenAnimation,
  AnimationSpeed,
  AnimationDistance,
  ViewTransitionAnimation,
  ModalAnimation,
  DrawerAnimation,
  TaskDockAnimation,
  VideoPlayerAnimation
} from '../types';

/**
 * Retorna a classe CSS correspondente à velocidade de animação configurada.
 */
export const getSpeedClass = (speed?: AnimationSpeed): string => {
  switch (speed) {
    case 'ultra-fast':
      return 'anim-speed-ultra-fast';
    case 'fast':
      return 'anim-speed-fast';
    case 'slow':
      return 'anim-speed-slow';
    case 'normal':
    default:
      return 'anim-speed-normal';
  }
};

/**
 * Retorna a duração em milissegundos associada à velocidade de animação.
 */
export const getSpeedMs = (speed?: AnimationSpeed): number => {
  switch (speed) {
    case 'ultra-fast':
      return 180;
    case 'fast':
      return 250;
    case 'slow':
      return 500;
    case 'normal':
    default:
      return 350;
  }
};

/**
 * Retorna a classe CSS correspondente à amplitude/distância de deslocamento configurada.
 */
export const getDistanceClass = (distance?: AnimationDistance): string => {
  switch (distance) {
    case 'subtle':
      return 'anim-dist-subtle';
    case 'large':
      return 'anim-dist-large';
    case 'normal':
    default:
      return 'anim-dist-normal';
  }
};

/**
 * Retorna o rótulo textual legível para a amplitude de movimento.
 */
export const getDistanceLabel = (distance?: AnimationDistance, isEn = false): string => {
  switch (distance) {
    case 'subtle':
      return isEn ? 'Subtle (16px)' : 'Sutil (16px)';
    case 'large':
      return isEn ? 'Wide (75px)' : 'Ampla (75px)';
    case 'normal':
    default:
      return isEn ? 'Medium (36px)' : 'Média (36px)';
  }
};

/**
 * Retorna a classe de animação para abertura de imagens no visualizador Lightbox.
 */
export const getOpenAnimationClass = (
  animation: LightboxOpenAnimation = 'expand',
  disableAllAnimations = false
): string => {
  if (disableAllAnimations || animation === 'none') return 'animate-photo-none';
  switch (animation) {
    case 'elastic':
      return 'animate-photo-elastic';
    case 'zoom':
      return 'animate-photo-zoom';
    case 'switch':
      return 'animate-photo-switch';
    case 'fade':
      return 'animate-photo-fade';
    case 'expand':
    default:
      return 'animate-photo-expand';
  }
};

/**
 * Retorna a classe de animação para transição entre fotos na navegação do Lightbox.
 */
export const getSwitchAnimationClass = (
  animation: ImageSwitchAnimation = 'switch',
  disableAllAnimations = false
): string => {
  if (disableAllAnimations || animation === 'none') return 'animate-photo-none';
  switch (animation) {
    case 'fade':
      return 'animate-photo-fade';
    case 'slide':
      return 'animate-photo-slide';
    case 'zoom':
      return 'animate-photo-zoom';
    case 'elastic':
      return 'animate-photo-elastic';
    case 'switch':
    default:
      return 'animate-photo-switch';
  }
};

/**
 * Retorna a classe de animação para apresentação contínua (Slideshow).
 */
export const getSlideshowAnimationClass = (
  animation: SlideshowAnimation = 'switch',
  disableAllAnimations = false
): string => {
  if (disableAllAnimations || animation === 'none') return 'animate-photo-none';
  switch (animation) {
    case 'fade':
      return 'animate-photo-fade';
    case 'slide':
      return 'animate-photo-slide';
    case 'zoom':
      return 'animate-photo-zoom';
    case 'switch':
    default:
      return 'animate-photo-switch';
  }
};

/**
 * Retorna a classe de animação para transição para o modo Tela Cheia (Fullscreen).
 */
export const getFullscreenAnimationClass = (
  animation: FullscreenAnimation = 'elastic',
  disableAllAnimations = false
): string => {
  if (disableAllAnimations || animation === 'none' || animation === 'instant') return 'animate-photo-none';
  switch (animation) {
    case 'smooth':
      return 'animate-fullscreen-fill';
    case 'elastic':
    default:
      return 'animate-fullscreen-entrance';
  }
};

/**
 * Retorna a classe de transição entre telas e abas principais da aplicação.
 */
export const getViewTransitionClass = (
  animation: ViewTransitionAnimation = 'fade',
  disableAllAnimations = false
): string => {
  if (disableAllAnimations || animation === 'none') return 'animate-photo-none';
  switch (animation) {
    case 'slide':
      return 'animate-view-slide';
    case 'zoom':
      return 'animate-view-zoom';
    case 'fade':
    default:
      return 'animate-view-fade';
  }
};

/**
 * Retorna a classe de animação para abertura de janelas e modais.
 */
export const getModalAnimationClass = (
  animation: ModalAnimation = 'scale',
  disableAllAnimations = false
): string => {
  if (disableAllAnimations || animation === 'none') return 'animate-photo-none';
  switch (animation) {
    case 'slide-up':
      return 'animate-modal-slide-up';
    case 'fade':
      return 'animate-modal-fade';
    case 'scale':
    default:
      return 'animate-modal-scale';
  }
};

/**
 * Retorna a classe de animação para gavetas laterais (Drawers).
 */
export const getDrawerAnimationClass = (
  animation: DrawerAnimation = 'slide',
  disableAllAnimations = false
): string => {
  if (disableAllAnimations || animation === 'none') return 'animate-photo-none';
  switch (animation) {
    case 'fade':
      return 'animate-drawer-fade';
    case 'slide':
    default:
      return 'animate-drawer-slide';
  }
};

/**
 * Retorna a classe de animação para o dock de tarefas em segundo plano.
 */
export const getTaskDockAnimationClass = (
  animation: TaskDockAnimation = 'slide-up',
  disableAllAnimations = false
): string => {
  if (disableAllAnimations || animation === 'none') return 'animate-photo-none';
  switch (animation) {
    case 'bounce':
      return 'animate-dock-bounce';
    case 'fade':
      return 'animate-dock-fade';
    case 'slide-up':
    default:
      return 'animate-dock-slide-up';
  }
};

/**
 * Retorna a classe de animação para o player de vídeo.
 */
export const getVideoPlayerAnimationClass = (
  animation: VideoPlayerAnimation = 'zoom',
  disableAllAnimations = false
): string => {
  if (disableAllAnimations || animation === 'none') return 'animate-photo-none';
  switch (animation) {
    case 'fade':
      return 'animate-video-fade';
    case 'slide-up':
      return 'animate-video-slide-up';
    case 'zoom':
    default:
      return 'animate-video-zoom';
  }
};
