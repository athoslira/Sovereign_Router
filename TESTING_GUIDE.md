# Guia de testes do Sovereign Router

## Preparação

1. Compile o plugin com `npm run build`.
2. Copie `main.js`, `manifest.json` e `styles.css` para o diretório do plugin no vault.
3. Recarregue os plugins da comunidade no Obsidian.
4. Abra **Sovereign Router: Open control center** e confirme que nenhum segredo aparece no painel.

## Checklist do painel de controle

### 1. Segurança de configuração

- Sem chave OpenRouter, o cartão deve mostrar **API key required** e a atualização do catálogo deve estar desabilitada.
- Sem URL/chave Hermes, o cartão deve mostrar **Not configured** e a seção de automações não deve executar ações.
- Em **Settings → Sovereign Router**, confirme que `data.json` contém somente nomes de segredos, nunca os valores das chaves.
- Configure um URL Docling HTTP remoto, por exemplo `http://docling.example.com`, e tente anexar um arquivo. O plugin deve recusar a chamada. HTTPS ou `http://localhost` devem continuar aceitos.

### 2. Chat e FinOps

1. Selecione uma chave OpenRouter e abra uma nova sessão.
2. Envie uma pergunta simples usando rota automática.
3. Confirme no cabeçalho da resposta: modelo efetivo, `usage.cost` em USD e `cache hit` quando o provedor informar cache.
4. Abra **Control** e confira que **OpenRouter FinOps** aumentou somente pelo custo da resposta recebida.
5. Feche/reabra o plugin: o total FinOps deve reiniciar, pois não é persistido.

### 3. Contexto, documentos e skills

- Pergunte algo que dependa de uma nota do vault. O Router deve carregar apenas trechos relevantes e indicar quantos arquivos foram usados.
- Anexe um PDF ou arquivo Office com Docling configurado. Confirme conversão, limite de tamanho e inclusão no contexto local.
- Use **Clear external cache** no painel. Somente documentos externos convertidos devem desaparecer; notas do vault continuam indexadas.
- Tente uma skill com `..`, caminho absoluto ou repositório GitHub fora da lista permitida. A skill deve ser rejeitada.

### 4. MCP remoto

1. Configure um endpoint MCP HTTPS conhecido, ou `http://localhost` para desenvolvimento local.
2. Ative **MCP** somente na sessão de teste.
3. Confirme que uma ferramenta marcada como somente leitura pode responder.
4. Tente uma ferramenta de escrita: ela deve permanecer bloqueada até **Allow write tools** estar habilitado e exigir confirmação a cada chamada.
5. Tente configurar MCP via HTTP remoto ou URL com credenciais embutidas. O Router deve rejeitar o endpoint.

### 5. Hermes e automações

No Hermes, mantenha o gateway em loopback e com chave obrigatória:

```text
API_SERVER_ENABLED=true
API_SERVER_HOST=127.0.0.1
API_SERVER_PORT=8642
API_SERVER_KEY=<segredo-forte>
```

1. Inicie o gateway Hermes e configure no Router `http://127.0.0.1:8642` e a chave por SecretStorage.
2. Em **Control**, selecione **Test connection**. O cartão deve mudar para **Connected**.
3. Se o runtime anunciar suporte a jobs, selecione **Refresh jobs**.
4. Crie um job seguro, sem escrita ou terminal, com prompt autocontido. Execute-o manualmente antes de confiar no cron.
5. Teste **Pause**, **Resume** e **Delete**. Cada ação deve pedir confirmação no Obsidian.
6. Deixe a lista de providers permitidos vazia e tente criar um job com provider override: o Router deve negar. Depois adicione explicitamente o perfil em **Permitted Hermes provider overrides** e repita.
7. Cancele uma execução Hermes no chat. O Router deve interromper o stream e solicitar parada ao runtime; trate a interrupção como não reversível para operações externas.

## Verificação de porta e exposição

No PowerShell, verifique que o Hermes está ouvindo apenas no loopback:

```powershell
Get-NetTCPConnection -LocalPort 8642 -ErrorAction SilentlyContinue |
  Select-Object LocalAddress, LocalPort, State, OwningProcess
```

O endereço esperado é `127.0.0.1` ou `::1`. Não publique essa porta diretamente na internet. Se for indispensável acesso remoto, use VPN ou túnel autenticado e mantenha `API_SERVER_KEY` forte.

## Critérios de aceite

- Build e testes automatizados passam.
- Não há chave em `data.json`, Markdown ou logs do plugin.
- O plugin não abre portas nem inicia processos; ele apenas consome APIs autorizadas.
- OpenRouter, GitHub, Docling, Hermes e MCP seguem HTTPS ou loopback HTTP conforme aplicável.
- Ações Hermes e MCP com efeito externo exigem confirmação ou seguem as políticas do runtime Hermes.
