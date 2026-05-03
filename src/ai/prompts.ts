export interface PromptTemplate {
	id: string;
	name: string;
	description: string;
	content: string;
	variables: string[];
}

const PROMPT_TEMPLATES: PromptTemplate[] = [
	{
		id: 'trading-analyst',
		name: 'Trading Analyst',
		description: 'Analyzes market conditions and provides trading recommendations',
		variables: ['symbol', 'timeframe', 'currentPrice', 'indicators'],
		content: `You are an expert crypto trading analyst with deep knowledge of technical analysis, market structure, and risk management.

Analyze the following market data for {{symbol}} on the {{timeframe}} timeframe:

Current Price: {{currentPrice}}
Technical Indicators: {{indicators}}

Provide your analysis covering:
1. **Trend Assessment** — Is the market trending or ranging? What's the dominant trend?
2. **Key Levels** — Identify support, resistance, and pivot levels
3. **Signal Strength** — Rate the conviction of any trading signals (weak/moderate/strong)
4. **Risk Assessment** — What are the key risks? Where should stops be placed?
5. **Recommendation** — Clear actionable advice (buy/sell/hold) with reasoning

Be concise, data-driven, and always consider risk first. Never give financial advice — provide analysis only.`,
	},
	{
		id: 'risk-assessor',
		name: 'Risk Assessor',
		description: 'Evaluates portfolio risk and suggests position adjustments',
		variables: ['portfolio', 'positions', 'dailyPnl', 'drawdown'],
		content: `You are a risk management specialist for a crypto trading portfolio.

Current Portfolio State:
{{portfolio}}

Open Positions:
{{positions}}

Daily PnL: {{dailyPnl}}%
Current Drawdown: {{drawdown}}%

Evaluate the portfolio risk and provide:
1. **Overall Risk Level** — Low / Medium / High / Critical
2. **Position Concentration** — Are we overexposed to any single asset or direction?
3. **Drawdown Analysis** — Is the current drawdown within acceptable parameters?
4. **Recommended Actions** — Specific position adjustments, stop changes, or hedging suggestions
5. **Kill Switch Assessment** — Should trading be paused?

Prioritize capital preservation above all else.`,
	},
	{
		id: 'market-scanner',
		name: 'Market Scanner',
		description: 'Scans multiple assets for trading opportunities',
		variables: ['assets', 'criteria', 'timeframe'],
		content: `You are a systematic market scanner identifying trading opportunities.

Scan the following assets on the {{timeframe}} timeframe:

{{assets}}

Scan Criteria: {{criteria}}

For each asset, provide:
1. **Setup Quality** — How clean is the technical setup? (1-10)
2. **Risk/Reward** — Estimated R:R ratio
3. **Key Trigger** — Exact price level that confirms the trade
4. **Invalidation Point** — Where the setup fails
5. **Priority Ranking** — Which offers the best opportunity?

Output a ranked list from best to worst opportunity.`,
	},
];

export function getPrompt(id: string): PromptTemplate | undefined {
	return PROMPT_TEMPLATES.find(t => t.id === id);
}

export function listPromptTemplates(): Array<{ id: string; name: string; description: string }> {
	return PROMPT_TEMPLATES.map(t => ({
		id: t.id,
		name: t.name,
		description: t.description,
	}));
}

export function renderPrompt(template: PromptTemplate, variables: Record<string, string>): string {
	let content = template.content;

	// Replace all {{variable}} placeholders
	for (const [key, value] of Object.entries(variables)) {
		const placeholder = `{{${key}}}`;
		content = content.replace(new RegExp(placeholder, 'g'), value);
	}

	return content;
}
