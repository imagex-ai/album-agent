import type { ExecutionErrorDetails } from './profileHubExecutionApi';

const pt = {
  confirm: 'Confirmar extração', confirming: 'Enviando confirmação…', confirmHint: 'A confirmação inicia as operações nos destinos revisados. Nenhuma mídia é salva antes desse clique.',
  tracking: 'Acompanhar extração', confirmed: 'Lote confirmado', operations: 'Operações', saved: 'Concluídas', failures: 'Com falha',
  snapshotHint: 'As operações usam os perfis, destinos e modalidades confirmados. Alterações na seleção atual valem para um novo lote.',
  preserved: 'Suas seleções continuam preservadas.', retry: 'Repetir falhas', retryOperation: 'Repetir falhas desta operação', retryHint: 'Somente operações com falha serão repetidas. As concluídas serão preservadas.',
  refresh: 'Verificar situação', newReview: 'Nova revisão', newReviewHint: 'Disponível quando este lote não tiver operações em andamento. A seleção atual será mantida.',
  checking: 'Consultando situação…', uncertain: 'Confirmação sem resposta', uncertainHint: 'A solicitação pode ter sido recebida. Verifique a situação ou reenvie a mesma confirmação; os destinos abaixo serão preservados.',
  resend: 'Reenviar a mesma confirmação', recoveryHint: 'O registro local do acompanhamento não está disponível. A fila continua no servidor; mantenha esta sessão para acompanhar.',
  confirmedProfiles: 'Perfis confirmados', selectedItems: 'Itens confirmados', processed: '{done} de {total} tarefas concluídas', showMore: 'Mostrar mais operações',
  source: 'Ver origem', groupItems: '{count} itens nesta operação', noConfirmed: 'Nenhum lote confirmado nesta sessão.',
  queued: 'Na fila', resolving: 'Verificando a coleção', running: 'Em andamento', succeeded: 'Concluído', failed: 'Falhou', interrupted: 'Interrompido',
  unavailable: 'Não foi possível concluir esta operação. Confira a origem e tente novamente. A seleção foi preservada.',
  connection: 'Não foi possível consultar o servidor. Verifique a conexão e consulte a situação novamente.',
  missingOriginal: 'O endereço original de um item ainda não foi encontrado. Abra a coleção no perfil para carregá-lo antes de confirmar.',
  invalidDestinations: 'Revise as pastas e modalidades de cada perfil antes de confirmar.',
  unsupported: 'Esta origem ou este tipo de endereço ainda não tem suporte à extração multiperfil. As seleções foram preservadas.',
  incomplete: 'Não foi possível verificar toda a coleção. Nenhuma parte desta coleção foi marcada como concluída.',
  incompleteCount: 'A origem informa {reported} itens, mas foram encontrados {found} após verificar {pages} páginas. Nada desta coleção foi iniciado. Atualize a origem ou revise os itens no perfil.',
  mismatch: 'A seleção já não corresponde aos originais encontrados. Retorne ao perfil e revise os itens.',
  persistence: 'O salvamento não pôde ser verificado. Confira o destino e tente novamente; os itens continuam selecionados.',
  conflict: 'O item ou o destino já foi alterado ou está sendo usado. Verifique o acompanhamento antes de tentar novamente.',
  notFound: 'Esta confirmação ainda não foi localizada no servidor. Verifique novamente antes de iniciar outro lote.',
  modeGallery: 'Galeria', modeStream: 'Web Stream', modeDownload: 'Download físico',
  invalidFolder: 'Nome de pasta inválido. Revise o destino conforme o tipo de mídia.',
  recoverHint: 'Consulte o lote registrado antes de iniciar uma nova confirmação.',
};
export type ProfileHubExecutionCopy = { [K in keyof typeof pt]: string };
export const profileHubExecutionCopy: Record<'pt-BR' | 'en-US', ProfileHubExecutionCopy> = {
  'pt-BR': pt,
  'en-US': {
    confirm: 'Confirm extraction', confirming: 'Sending confirmation…', confirmHint: 'Confirmation starts operations in the reviewed destinations. No media is saved before this click.',
    tracking: 'Track extraction', confirmed: 'Confirmed batch', operations: 'Operations', saved: 'Completed', failures: 'Failed',
    snapshotHint: 'Operations use the confirmed profiles, destinations and save modes. Changes to the current selection apply to a new batch.',
    preserved: 'Your selections are kept.', retry: 'Retry failures', retryOperation: 'Retry failed tasks in this operation', retryHint: 'Only failed operations are retried. Completed operations are kept.',
    refresh: 'Check status', newReview: 'New review', newReviewHint: 'Available when no operations in this batch are running. Your current selection will be kept.',
    checking: 'Checking status…', uncertain: 'Confirmation without a response', uncertainHint: 'The request may have been received. Check its status or resend the same confirmation; the destinations below are kept.',
    resend: 'Resend the same confirmation', recoveryHint: 'Local tracking storage is unavailable. The queue continues on the server; keep this session to track it.',
    confirmedProfiles: 'Confirmed profiles', selectedItems: 'Confirmed items', processed: '{done} of {total} tasks completed', showMore: 'Show more operations',
    source: 'View source', groupItems: '{count} items in this operation', noConfirmed: 'No batch confirmed in this session.',
    queued: 'Queued', resolving: 'Checking collection', running: 'Running', succeeded: 'Completed', failed: 'Failed', interrupted: 'Interrupted',
    unavailable: 'This operation could not finish. Check the source and try again. Your selection was kept.',
    connection: 'The server could not be reached. Check the connection and check the status again.',
    missingOriginal: 'An item’s original address is still missing. Open its collection in the profile to load it before confirming.',
    invalidDestinations: 'Review each profile’s folders and save modes before confirming.',
    unsupported: 'This source or address type does not support multi-profile extraction yet. Your selections were kept.',
    incomplete: 'The entire collection could not be verified. No part of this collection was marked as completed.',
    incompleteCount: 'The source reports {reported} items, but {found} were found after checking {pages} pages. Nothing in this collection was started. Refresh the source or review the items in the profile.',
    mismatch: 'The selection no longer matches the originals found. Go back to the profile and review the items.',
    persistence: 'Saving could not be verified. Check the destination and try again; the items remain selected.',
    conflict: 'The item or destination has changed or is already in use. Check tracking before trying again.',
    notFound: 'This confirmation has not been found on the server yet. Check again before starting another batch.',
    modeGallery: 'Gallery', modeStream: 'Web Stream', modeDownload: 'Physical download',
    invalidFolder: 'Invalid folder name. Review the destination for this media type.',
    recoverHint: 'Check the recorded batch before starting a new confirmation.',
  },
};
export function executionErrorText(code: string, copy: ProfileHubExecutionCopy, details?: ExecutionErrorDetails | null, language: 'pt-BR' | 'en-US' = 'pt-BR') {
  if (code === 'collection_incomplete' && details) {
    const number = new Intl.NumberFormat(language);
    return copy.incompleteCount.replace('{reported}', number.format(details.reported_count))
      .replace('{found}', number.format(details.found_count)).replace('{pages}', number.format(details.page_count));
  }
  if (code === 'selected_original_missing') return copy.missingOriginal;
  if (/destination|empty_selection|invalid_execution_request/.test(code)) return copy.invalidDestinations;
  if (/unsupported/.test(code)) return copy.unsupported;
  if (/incomplete|page_|collection_changed|empty_collection|empty_or_unrecognized/.test(code)) return copy.incomplete;
  if (/no_longer_matches|scope_mismatch|media_type_mismatch|type_changed/.test(code)) return copy.mismatch;
  if (/persist|gallery_media_changed/.test(code)) return copy.persistence;
  if (/already_running|conflict|owned_by|unsafe_|unowned_/.test(code)) return copy.conflict;
  if (code === 'execution_not_found') return copy.notFound;
  if (/connection|response/.test(code)) return copy.connection;
  return copy.unavailable;
}
