import { useEffect, useMemo, useState } from 'react'
import './App.css'

type Category = { slug: string; name: string; complete?: boolean }
type Result = { rank: number; query: string; sourceUrl: string | null }
type Page = 'Dashboard' | 'Candidates' | 'Compare' | 'Backtest' | 'Markets' | 'Methodology' | 'Admin'
type Loadable<T> = { data: T | null; loading: boolean; error: string | null }

const navigation: { name: Page; icon: string }[] = [
  { name: 'Dashboard', icon: 'grid' }, { name: 'Candidates', icon: 'search' },
  { name: 'Compare', icon: 'compare' }, { name: 'Backtest', icon: 'clock' },
  { name: 'Markets', icon: 'chart' }, { name: 'Methodology', icon: 'book' },
  { name: 'Admin', icon: 'settings' },
]

function Icon({ name, size = 19 }: { name: string; size?: number }) {
  const paths: Record<string, React.ReactNode> = {
    grid: <><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></>,
    search: <><circle cx="11" cy="11" r="7"/><path d="m16 16 4 4"/></>,
    compare: <><path d="M4 7h14m-3-3 3 3-3 3M20 17H6m3-3-3 3 3 3"/></>,
    clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
    chart: <><path d="M4 19V5M4 19h16M8 15l4-4 3 2 5-6"/></>,
    book: <><path d="M4 5.5c3-1 5-.5 8 1.5 3-2 5-2.5 8-1.5v13c-3-1-5-.5-8 1.5-3-2-5-2.5-8-1.5zM12 7v13"/></>,
    settings: <><circle cx="12" cy="12" r="3"/><path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42"/></>,
    arrow: <><path d="M5 12h14M14 7l5 5-5 5"/></>,
    external: <><path d="M13 5h6v6M19 5l-8 8"/><path d="M19 14v4a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h4"/></>,
    filter: <><path d="M4 7h16M7 12h10M10 17h4"/></>,
  }
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>
}

function useApi<T>(path: string | null): Loadable<T> {
  const [state, setState] = useState<Loadable<T> & { path: string | null }>({ path: null, data: null, loading: false, error: null })
  useEffect(() => {
    if (!path) return
    const controller = new AbortController()
    fetch(path, { signal: controller.signal, headers: { Accept: 'application/json' } })
      .then(async response => {
        if (!response.ok) throw new Error(`Request failed (${response.status})`)
        return response.json() as Promise<T>
      })
      .then(data => setState({ path, data, loading: false, error: null }))
      .catch(error => { if (!controller.signal.aborted) setState({ path, data: null, loading: false, error: error instanceof Error ? error.message : 'Request failed' }) })
    return () => controller.abort()
  }, [path])
  if (!path) return { data: null, loading: false, error: null }
  return state.path === path ? state : { data: null, loading: true, error: null }
}

function App() {
  const [page, setPage] = useState<Page>('Dashboard')
  const [yearChoice, setYear] = useState('')
  const [categoryChoice, setCategory] = useState('')
  const [search, setSearch] = useState('')
  const [compareYearChoice, setCompareYear] = useState('')
  const years = useApi<{ years: number[] }>('/api/years')
  const yearList = useMemo(() => Array.isArray(years.data?.years) ? [...years.data.years].sort((a, b) => b - a) : [], [years.data])
  const year = yearList.includes(Number(yearChoice)) ? yearChoice : String(yearList[0] ?? '')
  const compareYear = yearList.includes(Number(compareYearChoice)) ? compareYearChoice : String(yearList[1] ?? yearList[0] ?? '')
  const categories = useApi<{ categories: Category[] }>(year ? `/api/years/${encodeURIComponent(year)}/categories` : null)
  const categoryList = Array.isArray(categories.data?.categories) ? categories.data.categories : []
  const category = categoryList.some(item => item.slug === categoryChoice) ? categoryChoice : categoryList[0]?.slug ?? ''
  const results = useApi<{ category?: Category | null; results: Result[] }>(year && category ? `/api/years/${encodeURIComponent(year)}/categories/${encodeURIComponent(category)}/results` : null)
  const comparison = useApi<{ category?: Category | null; results: Result[] }>(page === 'Compare' && compareYear && category ? `/api/years/${encodeURIComponent(compareYear)}/categories/${encodeURIComponent(category)}/results` : null)
  const resultList = Array.isArray(results.data?.results) ? results.data.results : []
  const filtered = resultList.filter(item => item.query.toLowerCase().includes(search.toLowerCase()))
  const selectedCategory = categoryList.find(item => item.slug === category)

  const dataState = years.loading || categories.loading || results.loading ? 'loading' : years.error || categories.error || results.error ? 'error' : 'ready'
  const statusText = dataState === 'loading' ? 'Loading data' : dataState === 'error' ? 'Data unavailable' : yearList.length ? 'Historical data' : 'No data available'

  const selectYear = <label className="select-wrap"><span className="sr-only">Select year</span><select value={year} onChange={event => setYear(event.target.value)} disabled={!yearList.length}><option value="">Select year</option>{yearList.map(item => <option key={item} value={item}>{item}</option>)}</select><span className="chevron">⌄</span></label>
  const selectCategory = <label className="select-wrap"><span className="sr-only">Select category</span><select value={category} onChange={event => setCategory(event.target.value)} disabled={!categoryList.length}><option value="">Select category</option>{categoryList.map(item => <option key={item.slug} value={item.slug}>{categoryLabel(item)}</option>)}</select><span className="chevron">⌄</span></label>

  function resultRows(items: Result[]) {
    const comparedCategory = comparison.data?.category
    return <>{items === comparison.data?.results && comparedCategory?.complete === false && <p className="partial-note">Partial list: not all entries are available.</p>}{items.map(item => <div className="result-row" key={`${item.rank}-${item.query}`}><span className="rank">{String(item.rank).padStart(2, '0')}</span><span className="query-name">{item.query}</span><span className="result-category">{selectedCategory?.name ?? 'Search'}</span><span className="source">{item.sourceUrl && safeSource(item.sourceUrl) ? <a href={item.sourceUrl} target="_blank" rel="noreferrer">Source <Icon name="external" size={14}/></a> : '—'}</span></div>)}</>
  }
  function resultContent(items: Result[], emptyText = 'No results are available for this selection.') {
    if (dataState === 'loading') return <Empty title="Loading search data" text="Fetching the latest available historical lists." />
    if (dataState === 'error') return <Empty title="Unable to load data" text="The historical data service could not be reached. Please try again later." />
    if (!items.length) return <Empty title="Nothing to show yet" text={emptyText} />
    return <>{selectedCategory?.complete === false && <p className="partial-note">Partial list: not all entries are available.</p>}<div className="table-heading"><span>RANK</span><span>SEARCH QUERY</span><span>CATEGORY</span><span>SOURCE</span></div>{resultRows(items)}</>
  }

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark"><span>✳</span></div><div><strong>year<span>in</span>search</strong><small>RESEARCH TERMINAL</small></div></div>
      <div className="side-label">WORKSPACE</div>
      <nav aria-label="Main navigation">{navigation.map(item => <button key={item.name} className={`nav-item ${page === item.name ? 'active' : ''}`} onClick={() => setPage(item.name)}><Icon name={item.icon}/><span>{item.name}</span>{page === item.name && <span className="active-dot"/>}</button>)}</nav>
      <div className="sidebar-bottom"><div className="side-note"><div className="side-note-icon">✳</div><strong>Curiosity, quantified.</strong><p>A clearer view of what captured the world's attention.</p></div><div className="side-footer"><span className="status-dot"/> RESEARCH MODE <span>↗</span></div></div>
    </aside>
    <main className="main">
      <header className="topbar"><div className="breadcrumb">WORKSPACE <span>/</span> <strong>{page.toUpperCase()}</strong></div><div className="top-right"><span className="live-pill"><span className={dataState === 'error' ? 'status-dot muted' : 'status-dot'}/>{statusText}</span><span className="avatar">Y</span></div></header>
      <div className="content">
        {page === 'Dashboard' && <>
          <div className="page-heading"><div><div className="eyebrow"><span/> THE BIG PICTURE</div><h1>Year in Search<span className="heading-dot">.</span></h1><p>Explore the searches that defined the year.</p></div><div className="heading-controls">{selectYear}<button className="outline-button" onClick={() => setPage('Methodology')}><Icon name="book" size={16}/> How it works</button></div></div>
          <div className="hero"><div className="hero-copy"><span className="hero-label"><span/> THE YEAR, IN PERSPECTIVE</span><h2>Every search tells<br/><em>a story.</em></h2><p>From breakout moments to lasting cultural shifts, explore what the world was searching for.</p><button onClick={() => setPage('Candidates')}>Explore the rankings <Icon name="arrow" size={17}/></button></div><div className="hero-art" aria-hidden="true"><div className="orbit orbit-one"/><div className="orbit orbit-two"/><div className="orbit orbit-three"/><div className="orbit-core">✳</div><span className="art-star star-one">✦</span><span className="art-star star-two">✧</span><span className="art-star star-three">✦</span><div className="art-caption">A WORLD OF<br/><b>CURIOUS MINDS</b></div></div><span className="hero-index">01 / THE OVERVIEW</span></div>
          <div className="section-title"><div><div className="eyebrow">AT A GLANCE</div><h2>The landscape <span>↗</span></h2></div><p>A snapshot of the data available to explore.</p></div>
          <div className="metrics"><Metric label="YEARS AVAILABLE" value={years.loading ? '…' : years.error ? '—' : String(yearList.length)} detail="Historical collections" icon="clock"/><Metric label="CATEGORIES" value={categories.loading ? '…' : categories.error || !year ? '—' : String(categoryList.length)} detail={year ? `Available in ${year}` : 'Select an available year'} icon="grid"/><Metric label="RANKED SEARCHES" value={results.loading ? '…' : results.error || !category ? '—' : String(resultList.length)} detail={selectedCategory?.name ?? 'Select a category'} icon="chart"/></div>
          <div className="section-title ranking-title"><div><div className="eyebrow">EXPLORE THE DATA</div><h2>Search rankings <span>↗</span></h2><p>Discover the queries that made the list.</p></div><button className="text-button" onClick={() => setPage('Candidates')}>View all rankings <Icon name="arrow" size={16}/></button></div>
          <div className="panel"><div className="panel-top"><div><h3>Top searches</h3><p>Ranked historical results {year && `· ${year}`}</p></div><div className="panel-controls">{selectCategory}{selectYear}</div></div>{resultContent(resultList.slice(0, 5))}</div>
        </>}
        {page === 'Candidates' && <><PageIntro eyebrow="THE RANKINGS" title="Explore searches" description="Browse the queries that captured attention, one category at a time."/><div className="panel"><div className="panel-top"><div><h3>Search rankings</h3><p>Historical results, ordered by rank</p></div><div className="panel-controls">{selectCategory}{selectYear}</div></div><div className="search-bar"><Icon name="search" size={18}/><input aria-label="Filter searches" value={search} onChange={event => setSearch(event.target.value)} placeholder="Filter searches in this list..."/><Icon name="filter" size={17}/></div>{resultContent(filtered, search ? 'No searches match your filter.' : undefined)}</div></>}
        {page === 'Compare' && <><PageIntro eyebrow="SIDE BY SIDE" title="Compare years" description="See how ranked searches differ across years in the same category."/><div className="compare-controls">{selectCategory}<span>Compare</span>{selectYear}<span>with</span><label className="select-wrap"><span className="sr-only">Select comparison year</span><select value={compareYear} onChange={event => setCompareYear(event.target.value)} disabled={!yearList.length}><option value="">Select year</option>{yearList.map(item => <option key={item} value={item}>{item}</option>)}</select><span className="chevron">⌄</span></label></div><div className="compare-grid"><div className="panel"><div className="panel-top"><div><h3>{year || 'First year'}</h3><p>{selectedCategory?.name ?? 'Select a category'}</p></div></div>{resultContent(resultList)}</div><div className="panel"><div className="panel-top"><div><h3>{compareYear || 'Second year'}</h3><p>{selectedCategory?.name ?? 'Select a category'}</p></div></div>{comparison.loading ? <Empty title="Loading search data" text="Fetching historical results."/> : comparison.error ? <Empty title="Unable to load data" text="The comparison data could not be reached."/> : !comparison.data?.results?.length ? <Empty title="Nothing to show yet" text="No results are available for this category and year."/> : <>{<div className="table-heading"><span>RANK</span><span>SEARCH QUERY</span><span>CATEGORY</span><span>SOURCE</span></div>}{resultRows(comparison.data.results)}</>}</div></div></>}
        {page === 'Backtest' && <Unavailable eyebrow="LOOKING BACK" title="Backtest" description="Evaluate ideas against historical outcomes." detail="Backtesting data and an evaluation endpoint are not available yet. No performance estimates are shown."/>}
        {page === 'Markets' && <Unavailable eyebrow="MARKET CONTEXT" title="Markets" description="A place for market context alongside search research." detail="Market data is not connected. Prices and predictions are not available here."/>}
        {page === 'Admin' && <Unavailable eyebrow="WORKSPACE" title="Admin" description="Data administration and workspace status." detail="An administration endpoint is not available. This interface is read-only."/>}
        {page === 'Methodology' && <><PageIntro eyebrow="THE DETAILS" title="Methodology" description="How to interpret the People list and its limitations."/><div className="method-grid"><article className="panel method-card"><span className="number-label">01 / THE MEASURE</span><h3>Trending, not most searched</h3><p>The People list concerns increases in search interest from January 1 through November 25 compared with the same period in the prior year. A rank is not an absolute search count or a prediction.</p></article><article className="panel method-card"><span className="number-label">02 / ELIGIBILITY</span><h3>People and Passings</h3><p>Deceased people belong in Passings rather than People. Missing people remain eligible for the People list.</p></article><article className="panel method-card"><span className="number-label">03 / HYPOTHESES</span><h3>Names and aliases</h3><p>H1 uses the single highest-increase query. H2 folds accent variants together. H3 sums registered aliases. These are hypotheses, not confirmed calculations in this dashboard.</p></article><article className="panel method-card"><span className="number-label">04 / UNCERTAINTY</span><h3>Read with care</h3><p>Search samples are scaled and subject to uncertainty; small differences may not be meaningful. Coverage and interpretation are limited by the available source material, and the historical lists are supplied data rather than independently verified here.</p></article></div></>}
        <footer><span>✳ &nbsp; YEAR IN SEARCH <b> / &nbsp; RESEARCH TERMINAL</b></span><span>For research and informational purposes only. Not financial advice.</span></footer>
      </div>
    </main>
  </div>
}

function categoryLabel(category: Category) { return `${category.name}${category.complete === false ? ' (partial)' : ''}` }
function safeSource(url: string | null) { if (!url) return false; try { return ['http:', 'https:'].includes(new URL(url).protocol) } catch { return false } }
function Metric({ label, value, detail, icon }: { label: string; value: string; detail: string; icon: string }) { return <div className="metric"><div className="metric-head"><span>{label}</span><div><Icon name={icon} size={16}/></div></div><strong>{value}</strong><p><span>●</span> {detail}</p></div> }
function Empty({ title, text }: { title: string; text: string }) { return <div className="empty"><div className="empty-icon"><Icon name="search" size={21}/></div><strong>{title}</strong><p>{text}</p></div> }
function PageIntro({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) { return <div className="page-heading inner-heading"><div><div className="eyebrow"><span/> {eyebrow}</div><h1>{title}<span className="heading-dot">.</span></h1><p>{description}</p></div></div> }
function Unavailable({ eyebrow, title, description, detail }: { eyebrow: string; title: string; description: string; detail: string }) { return <><PageIntro eyebrow={eyebrow} title={title} description={description}/><div className="panel unavailable"><Empty title="Not available yet" text={detail}/></div></> }
export default App
