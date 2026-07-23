# Modelo operacional: Sovereign Router + Hermes Agent

## Propósito

Este documento define a lógica de funcionamento da integração entre o Sovereign Router e o Hermes Agent. Ele é uma referência de arquitetura e operação: explica quem decide, quem executa, onde os dados ficam e como automações devem ser criadas sem aumentar custo, permissões ou risco de forma desnecessária.

## Princípio central

O Sovereign Router é a interface de contexto e decisão dentro do Obsidian. O Hermes é o runtime externo de execução. Eles não são concorrentes e não devem duplicar funções.

```text
Obsidian / Sovereign Router = conversa, contexto do vault, roteamento e controle do usuário
Hermes Agent               = terminal, pesquisa, ferramentas, MCP local, jobs e execução durável
OpenRouter                 = provider/modelos e contabilidade da inferência
```

O plugin nunca instala programas, inicia processos, executa terminal ou abre conexões stdio. Quando uma tarefa exige essas capacidades, ela é delegada ao Hermes por API autenticada.

## Responsabilidades

| Componente | É responsável por | Não é responsável por |
|---|---|---|
| Sovereign Router | sessão do chat, contexto do vault, anexos, seleção de runtime, skills do vault, MCP remoto, cancelamento e FinOps de chat direto | terminal, subprocessos, cron, MCP stdio ou persistência operacional |
| Gatekeeper | escolher modelo, skill, contexto e, se habilitado, runtime Hermes para tarefa operacional | executar ações ou aprovar comandos perigosos |
| Hermes | pesquisa, terminal, scripts, subagentes, MCP local, automações, armazenamento de jobs e aprovações de execução | indexar o vault do Obsidian ou guardar chaves do plugin |
| Usuário | aprovar permissões, escolher fontes, revisar baixa confiança e definir limites de custo | entregar acesso irrestrito a disco, terminal ou rede |

## Modos de sessão

### Sovereign chat

Use para leitura, análise, escrita, contexto de notas, documentos, skills locais e MCP remoto controlado pelo plugin. O custo exibido no painel vem do `usage.cost` do OpenRouter.

### Hermes Agent

Use para tarefas com efeito operacional: pesquisa na web, scripts, terminal, automações, agentes, arquivos e MCP local. O Hermes mantém o ciclo de ferramentas e suas próprias políticas de aprovação.

### Auto runtime

Só deve ser habilitado após validação manual. O Gatekeeper pode sugerir Hermes apenas para tarefas explicitamente operacionais; escolha manual do usuário sempre prevalece.

## Fluxo de uma tarefa Hermes

```text
Usuário escolhe Hermes ou o Gatekeeper seleciona runtime Hermes
        ↓
Sovereign Router reúne pergunta e contexto autorizado
        ↓
Plugin chama a API local/autenticada do Hermes
        ↓
Hermes decide quais ferramentas usar e pede aprovação quando aplicável
        ↓
Hermes transmite progresso e resposta
        ↓
Plugin renderiza o resultado no painel
```

O botão Cancelar deve interromper o stream local e solicitar a parada da execução Hermes. A interrupção não deve ser tratada como garantia de reversão: operações de escrita devem ser idempotentes, atômicas e registradas.

## Fronteira de contexto e privacidade

1. O vault permanece local.
2. O Sovereign Router só envia trechos relevantes quando o Gatekeeper solicita contexto.
3. Uma sessão Hermes recebe apenas a pergunta, anexos e contexto explicitamente selecionados para ela.
4. Chaves ficam em SecretStorage do Obsidian ou no diretório seguro do Hermes; nunca em Markdown, `data.json`, logs ou prompts.
5. Dados operacionais produzidos por Hermes devem ser gravados em uma pasta explícita do vault, por exemplo `09 Data/`.

## MCPs e skills

Existem dois domínios distintos:

```text
Sovereign Router → MCP remoto por HTTP, usado apenas quando o usuário ativa MCP na sessão
Hermes           → MCP local/stdio ou remoto, configurado no runtime Hermes
```

Não se deve encaminhar automaticamente todos os MCPs do plugin para Hermes, nem todos os MCPs Hermes para o plugin. Cada domínio possui chaves, permissões e políticas próprias.

As skills locais do vault podem orientar um chat roteado. Skills operacionais, reutilizadas por automações, devem existir no Hermes como skills próprias e versionadas.

## Lógica de automação

Uma automação deve separar trabalho determinístico de julgamento por IA.

```text
Coleta / filtro / cache / validação     → script determinístico
Pesquisa / interpretação / classificação → Hermes + IA
Atualização estruturada                  → script de validação ou escrita atômica controlada
Revisão de exceções                      → usuário
```

Essa separação é obrigatória para controlar custo e confiabilidade. Um cron nunca deve pedir à IA para verificar repetidamente se algo mudou quando um script pode fazer essa comparação gratuitamente.

## Padrão de enriquecimento de dados

```text
Job a cada 6 horas
        ↓
Script seleciona até N registros pendentes ou vencidos
        ↓
Nenhum registro: wakeAgent=false, zero inferência
        ↓
Há lote: Hermes pesquisa fontes permitidas
        ↓
IA escreve resultado JSON com evidência, URL e confiança
        ↓
Validador atualiza CSV/JSON de forma atômica
        ↓
Registros com baixa confiança vão para revisão humana
```

O lote deve ser pequeno no início (cinco registros). Aumentos só ocorrem depois que custo, qualidade e taxa de falhas forem medidos.

## Regras obrigatórias para jobs

- Todo job deve ter prompt autocontido: jobs cron iniciam em sessão nova.
- Todo job deve declarar arquivos de entrada, saída, schema e limite de registros.
- Toda pesquisa deve registrar ao menos uma fonte e data de coleta.
- Nenhum fato sem evidência deve ser apresentado como confirmado.
- Escritas devem usar arquivo temporário seguido de substituição atômica.
- Jobs não devem gravar fora da pasta de dados autorizada.
- Jobs devem preferir APIs oficiais, feeds e páginas institucionais.
- Browser visual, subagentes e ferramentas extras só entram quando há ganho comprovado.
- O modelo e provider de jobs recorrentes devem ser fixados depois da validação para impedir surpresa de custo.

## Política de confiança

| Situação | Resultado |
|---|---|
| Fonte oficial e dado consistente | `confianca=alta`, `status=enriquecido` |
| Fonte institucional ou duas fontes consistentes | `confianca=media`, `status=enriquecido` |
| Fonte incompleta, conflito ou ausência de evidência | `confianca=baixa`, `status=revisar` |
| Falha de rede, parsing ou permissão | `status=erro` |

O agente nunca deve preencher dados ausentes por inferência. `revisar` é um resultado correto, não uma falha.

## Política de custo

1. Primeiro filtrar, depois chamar IA.
2. Usar cache por registro, fonte e data de validade.
3. Limitar fontes por registro.
4. Usar modelo econômico para pesquisa estrutural.
5. Reservar modelos mais fortes para exceções, síntese estratégica ou decisões complexas.
6. Desativar toolsets não usados pelo cron.
7. Registrar quantidade processada, fontes consultadas, falhas e custo por rodada.

Para chat direto, o FinOps vem do OpenRouter. Para Hermes, o controle vem da escolha de modelo, do limite de lote, das ferramentas habilitadas e dos logs de job.

## Política de segurança

- API Hermes deve ficar em `127.0.0.1` por padrão.
- API key Hermes é obrigatória mesmo em localhost.
- Aprovações devem ficar em modo `smart` ou `manual`.
- Cron deve negar comandos perigosos por padrão.
- Nunca usar modo YOLO em jobs de pesquisa e atualização.
- Nenhuma automação deve usar credenciais desnecessárias.
- Não expor a API Hermes à internet pública; para acesso remoto, usar VPN ou túnel autenticado.

## Processo de implantação

1. Configurar Hermes Desktop e modelo.
2. Descobrir `HERMES_HOME` usando `hermes dump`.
3. Criar o `.env` dentro de `HERMES_HOME` e habilitar a API.
4. Iniciar `hermes gateway run`.
5. Conectar o Sovereign Router usando URL local e SecretStorage.
6. Testar uma sessão Hermes sem escrita.
7. Testar uma automação manualmente.
8. Rodar o cron com lote mínimo.
9. Acompanhar logs e revisar resultados.
10. Só então habilitar auto runtime, aumentar lote ou adicionar ferramentas.

## Critérios de sucesso

O sistema está pronto quando:

- sessões Hermes funcionam no Obsidian e podem ser canceladas;
- nenhuma chave aparece no vault ou no `data.json`;
- automações não usam IA quando não há dados pendentes;
- dados enriquecidos têm fonte e confiança;
- atualizações não corrompem a base;
- casos incertos chegam à revisão humana;
- custo por rodada é conhecido e previsível;
- gateway e cron sobrevivem ao uso normal sem permissões amplas.

## Referências

- [Hermes API Server](https://hermes-agent.nousresearch.com/docs/user-guide/features/api-server/)
- [Hermes Desktop](https://hermes-agent.nousresearch.com/docs/user-guide/desktop)
- [Scheduled Tasks / Cron](https://hermes-agent.nousresearch.com/docs/user-guide/features/cron/)
- [Security](https://hermes-agent.nousresearch.com/docs/user-guide/security/)
- [Configuration](https://hermes-agent.nousresearch.com/docs/user-guide/configuration/)
