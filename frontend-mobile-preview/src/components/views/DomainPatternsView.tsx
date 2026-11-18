import { translations } from '../../i18n/translations';
import React, { useState } from 'react';
import { BookOpen, Plus, Sparkles, Check, Trash2, Edit2, Globe, ArrowRight } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { backendApi } from '../../services/realApi';

export const DomainPatternsView: React.FC = () => {
  const { domainPatterns, settings } = useAppStore();
  const isEn = settings.language === 'en-US';
  const tDom = translations[settings.language].domainPatterns;
  const [selectedDomain, setSelectedDomain] = useState<string | null>(null);

  const activePattern = domainPatterns.find(p => p.domain === selectedDomain) || domainPatterns[0];

  const handleDeletePattern = async (domain: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm((tDom.deleteConfirm || (isEn ? 'Do you want to remove the learned rules memory for {domain}?' : 'Deseja remover a memória de regras aprendidas para {domain}?')).replace('{domain}', domain))) {
      const ok = await backendApi.deleteDomainPattern(domain);
      if (ok) {
        useAppStore.setState(state => ({
          domainPatterns: state.domainPatterns.filter(p => p.domain !== domain)
        }));
      }
    }
  };

  return (
    <div className="p-3 sm:p-6 max-w-7xl mx-auto space-y-4 sm:space-y-6 min-w-0 max-w-full">
      <div>
        <h1 className="text-xl sm:text-2xl font-extrabold text-slate-100 flex items-center gap-2">
          <BookOpen size={22} className="text-brand-400" />
          {tDom.title || (isEn ? 'Learned Domain Rules Base (Inductive Patterns)' : 'Base de Regras Aprendidas por Domínio (Inductive Patterns)')}
        </h1>
        <p className="text-xs text-slate-400">
          {tDom.subtitle || (isEn ? 'Repository of regex rules and CDN transformations induced by AI for each website' : 'Repositório de regras de expressões regulares e transformações CDN induzidas pela IA para cada site')}
        </p>
      </div>

      {domainPatterns.length === 0 ? (
        <div className="glass-panel p-10 rounded-3xl border border-border text-center space-y-4 max-w-xl mx-auto my-12">
          <div className="w-14 h-14 rounded-2xl bg-brand-500/10 border border-brand-500/20 text-brand-400 flex items-center justify-center mx-auto">
            <Sparkles size={24} />
          </div>
          <h3 className="font-bold text-sm text-slate-200">{tDom.noDomainsMapped || (isEn ? "No Domains Mapped at the Moment" : "Nenhum Domínio Mapeado no Momento")}</h3>
          <p className="text-xs text-slate-400 leading-relaxed">
            {tDom.noDomainsDesc || (isEn ? 'Intelligence rules are recorded automatically as Agents extract new sites.' : 'As regras de inteligência são gravadas e aprendidas automaticamente conforme os Agentes extraem novos sites.')}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Left List of Domain Rules */}
          <div className="glass-panel p-4 rounded-3xl border border-border space-y-2 max-h-[70vh] overflow-y-auto">
            <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider px-2 mb-2">
              {(tDom.mappedDomains || (isEn ? 'Mapped Domains ({count})' : 'Domínios Mapeados ({count})')).replace('{count}', String(domainPatterns.length))}
            </div>
            {domainPatterns.map(pat => (
              <button
                key={pat.id}
                onClick={() => setSelectedDomain(pat.domain)}
                className={`w-full p-3.5 rounded-2xl border text-left transition-all relative group ${
                  activePattern?.domain === pat.domain
                    ? 'bg-brand-500/20 border-brand-500 shadow-glow-brand'
                    : 'bg-surface-elevated/40 border-border hover:border-slate-700'
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="font-bold text-xs text-slate-100 truncate pr-2">{pat.domain}</span>
                  <span className="text-[10px] font-mono text-emerald-400 font-bold shrink-0">
                    {Math.round((pat.confidenceScore || 0.95) * 100)}% Match
                  </span>
                </div>
                <p className="text-[11px] text-slate-400 truncate">{pat.name}</p>
                {pat.demonstrationCount && (
                  <div className="text-[10px] text-slate-500 mt-1">
                    {(tDom.demonstrationsRecorded || (isEn ? '{count} demonstration(s) recorded' : '{count} demonstração(ões) gravada(s)')).replace('{count}', String(pat.demonstrationCount))}
                  </div>
                )}
              </button>
            ))}
          </div>

          {/* Right Detail / Sandbox Tester */}
          {activePattern && (
            <div className="md:col-span-2 glass-panel p-6 rounded-3xl border border-border space-y-5 text-xs">
              <div className="flex items-center justify-between pb-3 border-b border-border">
                <div>
                  <h3 className="font-bold text-sm text-slate-100">{activePattern.name}</h3>
                  <span className="text-brand-400 font-mono text-[11px]">{activePattern.domain}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="px-3 py-1 rounded-full bg-emerald-500/20 text-emerald-400 font-mono font-bold text-[10px] border border-emerald-500/30">
                    {tDom.ruleValidated || (isEn ? 'Rule Validated in Original Resolution' : 'Regra Validada em Resolução Original')}
                  </span>
                  <button
                    onClick={(e) => handleDeletePattern(activePattern.domain, e)}
                    className="p-1.5 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 transition-all"
                    title={isEn ? "Delete rule" : "Excluir regra"}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>

              <div className="space-y-3 font-mono">
                <div className="p-3.5 rounded-2xl bg-surface-elevated border border-border space-y-1">
                  <span className="text-[10px] text-slate-500 block">{tDom.targetDomPattern || (isEn ? 'Target Pattern / DOM Signature:' : 'Padrão Alvo / Assinatura DOM:')}</span>
                  <span className="text-amber-400 font-bold break-all">{activePattern.regexTarget}</span>
                </div>

                <div className="p-3.5 rounded-2xl bg-surface-elevated border border-border space-y-1">
                  <span className="text-[10px] text-slate-500 block">{tDom.provenMethod || (isEn ? 'Original Resolution Vector (Proven Method):' : 'Vetor de Resolução Original (Proven Method):')}</span>
                  <span className="text-emerald-400 font-bold break-all">{activePattern.replacementPattern}</span>
                </div>
              </div>

              {/* Positive Signatures & Containers */}
              {activePattern.positiveSignatures && activePattern.positiveSignatures.length > 0 && (
                <div>
                  <h4 className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-2">
                    {isEn ? "Identified Positive Signatures" : "Assinaturas Positivas Identificadas"}
                  </h4>
                  <div className="flex flex-wrap gap-1.5">
                    {activePattern.positiveSignatures.map((sig, idx) => (
                      <span key={idx} className="px-2.5 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-[10px] font-mono">
                        {sig}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Negative Filters */}
              {activePattern.negativeFilters && activePattern.negativeFilters.length > 0 && (
                <div>
                  <h4 className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-2">
                    {tDom.exclusionFilters || (isEn ? 'Exclusion Filters (Banner / Logo Blocking)' : 'Filtros de Exclusão (Bloqueio de Banners / Logos)')}
                  </h4>
                  <div className="flex flex-wrap gap-1.5">
                    {activePattern.negativeFilters.map((neg, idx) => (
                      <span key={idx} className="px-2.5 py-1 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-300 text-[10px] font-mono">
                        {neg}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Test Sample Demonstration */}
              {activePattern.testSamples && activePattern.testSamples.length > 0 && (
                <div>
                  <h4 className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-2">
                    {tDom.inductionDemo || (isEn ? 'Induction Demonstration on Real Samples' : 'Demonstração de Indução em Amostras Reais')}
                  </h4>
                  {activePattern.testSamples.slice(0, 3).map((sample, idx) => (
                    <div key={idx} className="p-3.5 rounded-2xl bg-surface-elevated/60 border border-border space-y-1.5 text-[11px] font-mono mb-2">
                      <div className="text-slate-400 truncate">
                        <span className="text-slate-500">Thumb:</span> {sample.thumb}
                      </div>
                      <div className="text-emerald-300 font-bold truncate flex items-center gap-1.5">
                        <ArrowRight size={13} className="text-brand-400 shrink-0" />
                        <span>Resolved Original: {sample.resolved}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
