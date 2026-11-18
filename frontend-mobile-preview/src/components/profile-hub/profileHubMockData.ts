import { ProfileHeroData, HighlightItem, PlaylistItem, AlbumItem, MediaItemCard } from './profileHubTypes';

export const CANONICAL_PROFILE_DATA: ProfileHeroData = {
  id: 'lara-monteiro',
  name: 'Lara Monteiro',
  handle: '@laramonteiro',
  tagline: 'Viagens, lifestyle, bastidores e momentos especiais ✨',
  avatarUrl: 'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=crop&w=400&q=80',
  coverUrl: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=1920&q=80',
  verified: true,
  following: true,
  stats: {
    videos: 382,
    playlists: 12,
    albums: 35
  },
  destinationFolder: 'Lara Monteiro (ImageX)',
  availableFolders: [
    'Lara Monteiro (ImageX)',
    'Viagens & Férias',
    'Arquivo Geral',
    'Destaques 2026'
  ]
};

export const CANONICAL_HIGHLIGHTS: HighlightItem[] = [
  {
    id: 'hl-hero',
    title: 'Momentos Inesquecíveis',
    subtitle: 'Uma seleção especial dos meus melhores momentos',
    tag: 'EM DESTAQUE',
    thumbnailUrl: 'https://images.unsplash.com/photo-1510414842594-a61c69b5ae57?auto=format&fit=crop&w=800&q=80',
    type: 'video',
    isHero: true
  },
  {
    id: 'hl-2',
    title: 'Rotina em Movimento',
    countLabel: '12 vídeos',
    thumbnailUrl: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?auto=format&fit=crop&w=600&q=80',
    type: 'playlist'
  },
  {
    id: 'hl-3',
    title: 'Lugares Incríveis',
    countLabel: '8 vídeos',
    thumbnailUrl: 'https://images.unsplash.com/photo-1469854523086-cc02fe5d8800?auto=format&fit=crop&w=600&q=80',
    type: 'playlist'
  },
  {
    id: 'hl-4',
    title: 'Vida Real',
    countLabel: '15 vídeos',
    thumbnailUrl: 'https://images.unsplash.com/photo-1501339847302-ac426a4a7cbb?auto=format&fit=crop&w=600&q=80',
    type: 'video'
  },
  {
    id: 'hl-5',
    title: 'Bastidores',
    countLabel: '10 vídeos',
    thumbnailUrl: 'https://images.unsplash.com/photo-1452587925148-ce544e77e70d?auto=format&fit=crop&w=600&q=80',
    type: 'video'
  }
];

export const CANONICAL_PLAYLISTS: PlaylistItem[] = [
  {
    id: 'pl-viagens-mundo',
    title: 'Viagens pelo Mundo',
    videoCount: 46,
    loadedCount: 32,
    updatedAt: 'Atualizada há 2 dias',
    thumbnailUrl: 'https://images.unsplash.com/photo-1570077188670-e3a8d69ac5ff?auto=format&fit=crop&w=800&q=80',
    description: 'Uma jornada pelos lugares mais incríveis que já visitei. Praias, cidades, culturas e momentos que ficarão para sempre na memória. ✈️ 🌍'
  },
  {
    id: 'pl-rotina-lifestyle',
    title: 'Rotina & Lifestyle',
    videoCount: 32,
    loadedCount: 32,
    updatedAt: 'Atualizada há 5 dias',
    thumbnailUrl: 'https://images.unsplash.com/photo-1506744038136-46273834b3fb?auto=format&fit=crop&w=800&q=80',
    description: 'Vlogs diários, dicas de viagem, autocuidado e rotinas de gravação.'
  },
  {
    id: 'pl-momentos-especiais',
    title: 'Momentos Especiais',
    videoCount: 28,
    loadedCount: 28,
    updatedAt: 'Atualizada há 1 semana',
    thumbnailUrl: 'https://images.unsplash.com/photo-1517457373958-b7bdd4587205?auto=format&fit=crop&w=800&q=80',
    description: 'Comemorações com amigos, jantares e eventos exclusivos.'
  },
  {
    id: 'pl-bastidores',
    title: 'Bastidores',
    videoCount: 18,
    loadedCount: 18,
    updatedAt: 'Atualizada há 2 semanas',
    thumbnailUrl: 'https://images.unsplash.com/photo-1526778548025-fa2f459cd5c1?auto=format&fit=crop&w=800&q=80',
    description: 'Como são feitas as produções, erros de gravação e preparação.'
  },
  {
    id: 'pl-europa-2024',
    title: 'Europa 2024',
    videoCount: 64,
    loadedCount: 64,
    updatedAt: 'Atualizada há 3 semanas',
    thumbnailUrl: 'https://images.unsplash.com/photo-1516483638261-f4dbaf036963?auto=format&fit=crop&w=800&q=80',
    description: 'Tour completo pela Itália, Grécia, França e Suíça.'
  },
  {
    id: 'pl-verao-2024',
    title: 'Verão 2024',
    videoCount: 18,
    loadedCount: 18,
    updatedAt: 'Atualizada há 1 mês',
    thumbnailUrl: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=800&q=80',
    description: 'Dias ensolarados no litoral brasileiro e caribenho.'
  },
  {
    id: 'pl-por-do-sol',
    title: 'Pôr do Sol na Praia',
    videoCount: 24,
    loadedCount: 24,
    updatedAt: 'Atualizada há 2 meses',
    thumbnailUrl: 'https://images.unsplash.com/photo-1501785888041-af3ef285b470?auto=format&fit=crop&w=800&q=80',
    description: 'Os melhores fins de tarde gravados em 4K.'
  },
  {
    id: 'pl-grecia',
    title: 'Grécia',
    videoCount: 30,
    loadedCount: 30,
    updatedAt: 'Atualizada há 3 meses',
    thumbnailUrl: 'https://images.unsplash.com/photo-1533105079780-92b9be482077?auto=format&fit=crop&w=800&q=80',
    description: 'Santorini, Mykonos e Creta em detalhes.'
  },
  {
    id: 'pl-looks-dia',
    title: 'Looks do Dia',
    videoCount: 20,
    loadedCount: 20,
    updatedAt: 'Atualizada há 4 meses',
    thumbnailUrl: 'https://images.unsplash.com/photo-1490481651871-ab68de25d43d?auto=format&fit=crop&w=800&q=80',
    description: 'Inspirações de moda praia, urbano e noites especiais.'
  }
];

export const CANONICAL_ALBUMS: AlbumItem[] = [
  {
    id: 'alb-verao-2024',
    title: 'Verão 2024',
    photoCount: 128,
    updatedAt: 'Atualizado há 3 dias',
    thumbnailUrl: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=800&q=80',
    category: 'Praia & Sol'
  },
  {
    id: 'alb-europa',
    title: 'Europa',
    photoCount: 96,
    updatedAt: 'Atualizado há 5 dias',
    thumbnailUrl: 'https://images.unsplash.com/photo-1516483638261-f4dbaf036963?auto=format&fit=crop&w=800&q=80',
    category: 'Fotos e paisagens'
  },
  {
    id: 'alb-looks-dia',
    title: 'Looks do Dia',
    photoCount: 74,
    updatedAt: 'Atualizado há 1 semana',
    thumbnailUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=800&q=80',
    category: 'Lifestyle'
  },
  {
    id: 'alb-natureza',
    title: 'Natureza',
    photoCount: 52,
    updatedAt: 'Atualizado há 2 semanas',
    thumbnailUrl: 'https://images.unsplash.com/photo-1506744038136-46273834b3fb?auto=format&fit=crop&w=800&q=80',
    category: 'Paisagens'
  },
  {
    id: 'alb-cidades',
    title: 'Cidades',
    photoCount: 86,
    updatedAt: 'Atualizado há 3 semanas',
    thumbnailUrl: 'https://images.unsplash.com/photo-1477959858617-67f30bc75b82?auto=format&fit=crop&w=800&q=80',
    category: 'Arquitetura'
  },
  {
    id: 'alb-bastidores',
    title: 'Bastidores',
    photoCount: 68,
    updatedAt: 'Atualizado há 1 mês',
    thumbnailUrl: 'https://images.unsplash.com/photo-1452587925148-ce544e77e70d?auto=format&fit=crop&w=800&q=80',
    category: 'Produção'
  }
];

export const CANONICAL_PLAYLIST_VIDEOS: MediaItemCard[] = [
  {
    id: 'vid-1',
    title: '1. Chegada em Santorini',
    thumbnailUrl: 'https://images.unsplash.com/photo-1570077188670-e3a8d69ac5ff?auto=format&fit=crop&w=600&q=80',
    duration: '04:12',
    resolution: '1080p',
    timeAgo: 'Há 2 dias',
    type: 'video',
    collectionId: 'pl-viagens-mundo',
    collectionTitle: 'Viagens pelo Mundo'
  },
  {
    id: 'vid-2',
    title: '2. Explorando a Cidade',
    thumbnailUrl: 'https://images.unsplash.com/photo-1533105079780-92b9be482077?auto=format&fit=crop&w=600&q=80',
    duration: '06:28',
    resolution: '1080p',
    timeAgo: 'Há 3 dias',
    type: 'video',
    collectionId: 'pl-viagens-mundo',
    collectionTitle: 'Viagens pelo Mundo'
  },
  {
    id: 'vid-3',
    title: '3. Pôr do Sol Incrível',
    thumbnailUrl: 'https://images.unsplash.com/photo-1510414842594-a61c69b5ae57?auto=format&fit=crop&w=600&q=80',
    duration: '03:45',
    resolution: '1080p',
    timeAgo: 'Há 4 dias',
    type: 'video',
    collectionId: 'pl-viagens-mundo',
    collectionTitle: 'Viagens pelo Mundo'
  },
  {
    id: 'vid-4',
    title: '4. Dia na Praia',
    thumbnailUrl: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=600&q=80',
    duration: '08:10',
    resolution: '1080p',
    timeAgo: 'Há 5 dias',
    type: 'video',
    collectionId: 'pl-viagens-mundo',
    collectionTitle: 'Viagens pelo Mundo'
  },
  {
    id: 'vid-5',
    title: '5. Gastronomia Local',
    thumbnailUrl: 'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?auto=format&fit=crop&w=600&q=80',
    duration: '05:21',
    resolution: '1080p',
    timeAgo: 'Há 6 dias',
    type: 'video',
    collectionId: 'pl-viagens-mundo',
    collectionTitle: 'Viagens pelo Mundo'
  },
  {
    id: 'vid-6',
    title: '6. Passeio de Barco',
    thumbnailUrl: 'https://images.unsplash.com/photo-1506744038136-46273834b3fb?auto=format&fit=crop&w=600&q=80',
    duration: '07:14',
    resolution: '1080p',
    timeAgo: 'Há 1 semana',
    type: 'video',
    collectionId: 'pl-viagens-mundo',
    collectionTitle: 'Viagens pelo Mundo'
  },
  {
    id: 'vid-7',
    title: '7. Ruas e Cultura',
    thumbnailUrl: 'https://images.unsplash.com/photo-1516483638261-f4dbaf036963?auto=format&fit=crop&w=600&q=80',
    duration: '04:33',
    resolution: '1080p',
    timeAgo: 'Há 1 semana',
    type: 'video',
    collectionId: 'pl-viagens-mundo',
    collectionTitle: 'Viagens pelo Mundo'
  },
  {
    id: 'vid-8',
    title: '8. Noite na Cidade',
    thumbnailUrl: 'https://images.unsplash.com/photo-1514565131-fce0801e5785?auto=format&fit=crop&w=600&q=80',
    duration: '05:50',
    resolution: '1080p',
    timeAgo: 'Há 1 semana',
    type: 'video',
    collectionId: 'pl-viagens-mundo',
    collectionTitle: 'Viagens pelo Mundo'
  },
  {
    id: 'vid-9',
    title: '9. Último Dia',
    thumbnailUrl: 'https://images.unsplash.com/photo-1469854523086-cc02fe5d8800?auto=format&fit=crop&w=600&q=80',
    duration: '06:15',
    resolution: '1080p',
    timeAgo: 'Há 1 semana',
    type: 'video',
    collectionId: 'pl-viagens-mundo',
    collectionTitle: 'Viagens pelo Mundo'
  }
];

export const CANONICAL_ALBUM_PHOTOS: MediaItemCard[] = [
  {
    id: 'img-4823',
    title: 'IMG_4823.jpg',
    thumbnailUrl: 'https://images.unsplash.com/photo-1552832230-c0197dd311b5?auto=format&fit=crop&w=600&q=80',
    resolution: '4K',
    timeAgo: 'Há 3 dias',
    type: 'photo',
    collectionId: 'alb-europa',
    collectionTitle: 'Europa'
  },
  {
    id: 'img-4824',
    title: 'IMG_4824.jpg',
    thumbnailUrl: 'https://images.unsplash.com/photo-1516483638261-f4dbaf036963?auto=format&fit=crop&w=600&q=80',
    resolution: '4K',
    timeAgo: 'Há 3 dias',
    type: 'photo',
    collectionId: 'alb-europa',
    collectionTitle: 'Europa'
  },
  {
    id: 'img-4825',
    title: 'IMG_4825.jpg',
    thumbnailUrl: 'https://images.unsplash.com/photo-1531572753322-ad063cecc140?auto=format&fit=crop&w=600&q=80',
    resolution: '4K',
    timeAgo: 'Há 3 dias',
    type: 'photo',
    collectionId: 'alb-europa',
    collectionTitle: 'Europa'
  },
  {
    id: 'img-4826',
    title: 'IMG_4826.jpg',
    thumbnailUrl: 'https://images.unsplash.com/photo-1514890547357-a9ee288728e0?auto=format&fit=crop&w=600&q=80',
    resolution: '4K',
    timeAgo: 'Há 3 dias',
    type: 'photo',
    collectionId: 'alb-europa',
    collectionTitle: 'Europa'
  },
  {
    id: 'img-4827',
    title: 'IMG_4827.jpg',
    thumbnailUrl: 'https://images.unsplash.com/photo-1533105079780-92b9be482077?auto=format&fit=crop&w=600&q=80',
    resolution: '4K',
    timeAgo: 'Há 3 dias',
    type: 'photo',
    collectionId: 'alb-europa',
    collectionTitle: 'Europa'
  },
  {
    id: 'img-4828',
    title: 'IMG_4828.jpg',
    thumbnailUrl: 'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?auto=format&fit=crop&w=600&q=80',
    resolution: '4K',
    timeAgo: 'Há 3 dias',
    type: 'photo',
    collectionId: 'alb-europa',
    collectionTitle: 'Europa'
  },
  {
    id: 'img-4829',
    title: 'IMG_4829.jpg',
    thumbnailUrl: 'https://images.unsplash.com/photo-1506744038136-46273834b3fb?auto=format&fit=crop&w=600&q=80',
    resolution: '4K',
    timeAgo: 'Há 3 dias',
    type: 'photo',
    collectionId: 'alb-europa',
    collectionTitle: 'Europa'
  },
  {
    id: 'img-4830',
    title: 'IMG_4830.jpg',
    thumbnailUrl: 'https://images.unsplash.com/photo-1469854523086-cc02fe5d8800?auto=format&fit=crop&w=600&q=80',
    resolution: '4K',
    timeAgo: 'Há 3 dias',
    type: 'photo',
    collectionId: 'alb-europa',
    collectionTitle: 'Europa'
  },
  {
    id: 'img-4831',
    title: 'IMG_4831.jpg',
    thumbnailUrl: 'https://images.unsplash.com/photo-1526778548025-fa2f459cd5c1?auto=format&fit=crop&w=600&q=80',
    resolution: '4K',
    timeAgo: 'Há 3 dias',
    type: 'photo',
    collectionId: 'alb-europa',
    collectionTitle: 'Europa'
  },
  {
    id: 'img-4832',
    title: 'IMG_4832.jpg',
    thumbnailUrl: 'https://images.unsplash.com/photo-1501785888041-af3ef285b470?auto=format&fit=crop&w=600&q=80',
    resolution: '4K',
    timeAgo: 'Há 3 dias',
    type: 'photo',
    collectionId: 'alb-europa',
    collectionTitle: 'Europa'
  },
  {
    id: 'img-4833',
    title: 'IMG_4833.jpg',
    thumbnailUrl: 'https://images.unsplash.com/photo-1510414842594-a61c69b5ae57?auto=format&fit=crop&w=600&q=80',
    resolution: '4K',
    timeAgo: 'Há 3 dias',
    type: 'photo',
    collectionId: 'alb-europa',
    collectionTitle: 'Europa'
  },
  {
    id: 'img-4834',
    title: 'IMG_4834.jpg',
    thumbnailUrl: 'https://images.unsplash.com/photo-1570077188670-e3a8d69ac5ff?auto=format&fit=crop&w=600&q=80',
    resolution: '4K',
    timeAgo: 'Há 3 dias',
    type: 'photo',
    collectionId: 'alb-europa',
    collectionTitle: 'Europa'
  }
];

export const CANONICAL_GIF_ITEMS: MediaItemCard[] = [
  {
    id: 'gif-1',
    title: 'Pôr do Sol 1',
    thumbnailUrl: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=600&q=80',
    duration: '4s',
    timeAgo: 'Há 2 dias',
    type: 'gif',
    collectionId: 'gif-por-sol',
    collectionTitle: 'Pôr do Sol na Praia'
  },
  {
    id: 'gif-2',
    title: 'Ondas Douradas',
    thumbnailUrl: 'https://images.unsplash.com/photo-1510414842594-a61c69b5ae57?auto=format&fit=crop&w=600&q=80',
    duration: '6s',
    timeAgo: 'Há 2 dias',
    type: 'gif',
    collectionId: 'gif-por-sol',
    collectionTitle: 'Pôr do Sol na Praia'
  },
  {
    id: 'gif-3',
    title: 'Céu Alaranjado',
    thumbnailUrl: 'https://images.unsplash.com/photo-1501785888041-af3ef285b470?auto=format&fit=crop&w=600&q=80',
    duration: '5s',
    timeAgo: 'Há 2 dias',
    type: 'gif',
    collectionId: 'gif-por-sol',
    collectionTitle: 'Pôr do Sol na Praia'
  },
  {
    id: 'gif-4',
    title: 'Palmeiras e Vento',
    thumbnailUrl: 'https://images.unsplash.com/photo-1506744038136-46273834b3fb?auto=format&fit=crop&w=600&q=80',
    duration: '5s',
    timeAgo: 'Há 2 dias',
    type: 'gif',
    collectionId: 'gif-por-sol',
    collectionTitle: 'Pôr do Sol na Praia'
  },
  {
    id: 'gif-5',
    title: 'Mar Calmo',
    thumbnailUrl: 'https://images.unsplash.com/photo-1469854523086-cc02fe5d8800?auto=format&fit=crop&w=600&q=80',
    duration: '4s',
    timeAgo: 'Há 2 dias',
    type: 'gif',
    collectionId: 'gif-por-sol',
    collectionTitle: 'Pôr do Sol na Praia'
  },
  {
    id: 'gif-6',
    title: 'Crepúsculo',
    thumbnailUrl: 'https://images.unsplash.com/photo-1570077188670-e3a8d69ac5ff?auto=format&fit=crop&w=600&q=80',
    duration: '6s',
    timeAgo: 'Há 2 dias',
    type: 'gif',
    collectionId: 'gif-por-sol',
    collectionTitle: 'Pôr do Sol na Praia'
  }
];
