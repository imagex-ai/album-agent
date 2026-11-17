# Feedback e relatórios de erro

O recurso precisa de um projeto Sentry e do DSN público desse projeto. Sem DSN,
o aplicativo não inicializa o SDK e o envio de feedback fica indisponível.
Não coloque tokens de autenticação ou credenciais em variáveis `VITE_*`.

Para desenvolvimento local, copie o modelo em `frontend-mobile-preview/.env.example`
para `.env.local` na mesma pasta, preencha `VITE_SENTRY_DSN` e reinicie o Vite.
Esse arquivo local não deve ser versionado.

Para builds do GitHub Actions, configure a variável de repositório
`VITE_SENTRY_DSN` com o DSN público antes de gerar a release. O frontend embute
variáveis `VITE_*` durante o build; mudar a variável exige gerar outro build.

O botão **Enviar feedback** envia apenas após confirmação. O texto, o e-mail
opcional e uma captura de tela adicionada voluntariamente pelo usuário seguem
para o Sentry. A captura pode conter dados privados e deve ser revisada por quem
envia. Não há captura automática de tela, replay de sessão ou rastreamento de
navegação.

Relatórios automáticos abrangem erros inesperados não tratados no frontend.
Eles estão inicialmente habilitados e podem ser desligados nas configurações.
O cliente remove mensagens, URLs, caminhos, dados da biblioteca, breadcrumbs,
usuário, cabeçalhos e contexto do evento; mantém o tipo genérico, linhas e
colunas da pilha e a versão. O SDK é configurado sem integrações padrão, com
coleta de usuário, cookies, cabeçalhos, corpos e parâmetros de URL desativada.

Como em qualquer conexão de rede direta, o provedor recebe a conexão de rede do
dispositivo; confirme também as configurações de privacidade e retenção no
projeto Sentry antes de habilitar o serviço. Não afirme anonimato absoluto.
O backend e erros tratados silenciosamente não são cobertos por esse mecanismo.
Uma instalação antiga que ainda não tem o SDK consegue compilar, mas o envio
fica indisponível até instalar as dependências e gerar o frontend novamente.
