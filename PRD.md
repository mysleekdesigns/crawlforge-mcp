# Product Requirements Document: CrawlForge MCP Marketing Website

## Executive Summary

### Vision
Create a developer-first platform that positions CrawlForge MCP as the premier web scraping solution for AI applications, following Firecrawl's successful model of offering a free MCP server that drives API service revenue.

### Business Model
- **Core Revenue**: API-based subscription service with credit system
- **Free Tier**: MCP server + limited API credits to drive adoption
- **Monetization**: Tiered monthly/annual subscriptions for API access
- **Target Market**: AI developers, enterprises using Claude/Cursor, data scientists

### Key Success Metrics
- 10,000+ free tier signups in first 6 months
- 5% conversion to paid plans
- $50K MRR within 12 months
- 500+ GitHub stars on MCP server repository

## Product Strategy

### Value Proposition
"The most comprehensive web scraping MCP server with 19 specialized tools. From basic extraction to advanced AI research, stealth browsing, and multi-country localization - CrawlForge MCP handles everything while you focus on building."

### Competitive Advantages
- **19 Comprehensive Tools**: More capabilities than any other MCP scraping solution (vs Firecrawl's 5)
- **Deep Research**: Advanced multi-stage research with AI synthesis and source verification
- **Stealth Mode**: Anti-detection browser management with fingerprint randomization
- **Localization**: 26 countries support with geo-blocking bypass and RTL languages
- **Browser Automation**: Full action chains for dynamic content and form filling
- **Change Tracking**: Monitor and track website changes with significance scoring
- **Batch Processing**: Async job management for large-scale scraping
- **LLMs.txt Generator**: Create AI compliance files for websites
- **Open Source Core**: Transparent, community-driven development

### Target Personas

1. **AI Developer (Primary)**
   - Building LLM applications with Claude/Cursor
   - Needs reliable web data extraction
   - Values developer experience and documentation
   - Budget: $50-500/month

2. **Enterprise Data Team**
   - Large-scale data extraction needs
   - Requires SLAs and support
   - Compliance and security requirements
   - Budget: $1000+/month

3. **Startup Founder**
   - Building AI-powered products
   - Cost-conscious but needs reliability
   - Quick integration requirements
   - Budget: $100-300/month

## Pricing Model

### Subscription Tiers

#### Free Tier - "Explorer"
- **Price**: $0
- **Credits**: 1,000 one-time credits
- **Features**:
  - Full MCP server access
  - All 16 tools available
  - 2 concurrent requests
  - Community support
  - Rate limit: 10 requests/minute

#### Hobby - "Developer"
- **Price**: $19/month (or $190/year - 2 months free)
- **Credits**: 5,000/month
- **Features**:
  - Everything in Free
  - 5 concurrent requests
  - Email support
  - Rate limit: 30 requests/minute
  - Basic webhook notifications

#### Professional - "Growth"
- **Price**: $99/month (or $990/year - 2 months free)
- **Credits**: 50,000/month
- **Features**:
  - Everything in Hobby
  - 20 concurrent requests
  - Priority email support
  - Rate limit: 100 requests/minute
  - Advanced webhooks
  - Custom headers support
  - 99.5% uptime SLA

#### Business - "Scale"
- **Price**: $399/month (or $3,990/year - 2 months free)
- **Credits**: 250,000/month
- **Features**:
  - Everything in Professional
  - 50 concurrent requests
  - Slack support channel
  - Rate limit: 500 requests/minute
  - Dedicated proxy pool
  - 99.9% uptime SLA
  - Advanced analytics dashboard

#### Enterprise - Custom
- **Price**: Contact sales
- **Features**:
  - Unlimited credits
  - Custom rate limits
  - Dedicated infrastructure
  - 24/7 phone support
  - Custom SLAs
  - SSO/SAML
  - Audit logs
  - Custom contract terms

### Add-Ons
- **Auto-Recharge**: $15 per 1,000 credits
- **Extra Credit Pack**: $12/month per 1,000 credits
- **Premium Support**: $199/month
- **Dedicated Proxy Pool**: $299/month

### Credit Usage

| Tool | Credits per Use | Description |
|------|----------------|-------------|
| fetch_url | 1 | Basic URL fetching |
| extract_text | 1 | Clean text extraction |
| extract_links | 1 | Link discovery |
| extract_metadata | 1 | Metadata extraction |
| scrape_structured | 2 | CSS selector scraping |
| search_web | 1 per result | Web search (Google/DuckDuckGo) |
| crawl_deep | 1 per page | Deep website crawling |
| map_site | 5 per call | Site structure mapping |
| extract_content | 2 | Smart content extraction |
| process_document | 3 | PDF and document processing |
| summarize_content | 5 | AI-powered summarization |
| analyze_content | 5 | Sentiment and language analysis |
| batch_scrape | 1 per URL | Bulk URL processing |
| scrape_with_actions | 3 per action | Browser automation scraping |
| deep_research | 10 per query | Multi-stage AI research |
| track_changes | 2 per check | Change monitoring |
| generate_llms_txt | 8 per site | LLMs.txt file generation |
| stealth_mode | 5 per session | Anti-detection browsing |
| localization | 3 per request | Geo-targeted scraping |

## Website Architecture

### Information Architecture

```
├── Home (/)
│   ├── Hero Section
│   ├── Live Demo
│   ├── Features Grid
│   ├── Use Cases
│   ├── Social Proof
│   └── CTA
├── Product
│   ├── Features (/features)
│   ├── Tools Directory (/tools)
│   ├── Integrations (/integrations)
│   └── Changelog (/changelog)
├── Developers
│   ├── Documentation (/docs)
│   ├── API Reference (/api)
│   ├── Playground (/playground) [Phase 2]
│   ├── Templates (/templates)
│   └── SDKs (/sdks)
├── Pricing (/pricing)
│   ├── Calculator
│   ├── Compare Plans
│   └── Enterprise Form
├── Resources
│   ├── Blog (/blog)
│   ├── Tutorials (/tutorials)
│   ├── Case Studies (/cases)
│   └── Support (/support)
├── Company
│   ├── About (/about)
│   └── Contact (/contact)
└── User Portal
    ├── Sign Up (/signup)
    ├── Sign In (/signin)
    ├── Dashboard (/dashboard)
    ├── API Keys (/keys)
    ├── Usage (/usage)
    └── Billing (/billing)
```

### Key Pages Design

#### 1. Homepage
**Hero Section**
- Headline: "19 Powerful Tools. One MCP Server. Unlimited Possibilities."
- Subheadline: "The most comprehensive web scraping MCP server for Claude and Cursor - with stealth mode, localization, and AI research capabilities"
- CTA: "Start Free - 1,000 Credits" | "View Documentation"
- Code examples showing MCP usage (static initially, live demo in Phase 2)
- Badge: "4x more tools than Firecrawl"

**Features Section**
- 19 tools showcase with icons (organized by category)
- Interactive hover states showing code snippets
- "Why CrawlForge MCP?" comparison table
- Unique features highlight: Stealth Mode, Localization, LLMs.txt

**Social Proof**
- Rotating testimonials from developers
- Company logos (with permission)
- GitHub stars counter
- "Trusted by 10,000+ developers"

**Use Cases Carousel**
- AI Chat Assistants
- Lead Generation
- Market Research
- Content Monitoring
- Data Migration

#### 2. Pricing Page (/pricing)
- Interactive credit calculator
- Plan comparison table
- FAQ section
- Enterprise contact form
- Annual discount banner
- "Most Popular" badge on Growth tier

#### 3. Dashboard (/dashboard)
- Usage overview chart
- API key management
- Recent requests log
- Credit balance widget
- Quick start guide
- Upgrade prompts based on usage

#### 4. Interactive Playground (/playground) [Phase 2]
**Future Feature - Phase 2 Development**
- Split-screen interface
- Left: Tool selector and parameter inputs
- Right: Live results preview
- Code generation for multiple languages
- Share functionality for examples
- Rate-limited to prevent abuse
- "Try it now" CTAs throughout the site will initially link to documentation with code examples

## Technical Requirements

### Frontend Stack
- **Framework**: Next.js 15 with App Router
- **UI Components**: shadcn/ui + Radix UI primitives
- **Styling**: Tailwind CSS
- **State Management**: Zustand
- **Forms**: React Hook Form + Zod
- **Charts**: Recharts
- **Code Highlighting**: Shiki
- **Analytics**: PostHog
- **Monitoring**: Sentry

### Hosting & Infrastructure

#### Recommended Stack by Stage

**MVP/Launch (0-1K users) - $50-100/month**
```
├── Frontend
│   └── Vercel (Next.js optimized)
├── Backend
│   └── Railway or Render
│       ├── Node.js API service
│       ├── Managed PostgreSQL
│       └── Managed Redis
├── CDN/Security
│   └── Cloudflare (Free tier)
└── Monitoring
    └── Sentry + PostHog
```

**Growth Stage (1K-10K users) - $200-500/month**
```
├── Frontend
│   └── Vercel Pro
├── Backend
│   └── AWS ECS Fargate or Google Cloud Run
│       ├── Containerized Node.js services
│       ├── AWS RDS PostgreSQL / Supabase
│       └── ElastiCache Redis
├── Queue
│   └── AWS SQS or BullMQ
├── CDN/Security
│   └── Cloudflare Pro
└── Monitoring
    └── Datadog or New Relic
```

**Scale Stage (10K+ users) - $500-2000+/month**
```
├── Frontend
│   └── Vercel Enterprise or CloudFront + S3
├── Backend
│   └── Kubernetes (EKS/GKE)
│       ├── Auto-scaling Node.js pods
│       ├── Aurora Serverless or Neon
│       └── Redis Cluster
├── Queue & Events
│   └── AWS EventBridge + SQS
├── CDN/Security
│   └── Cloudflare Enterprise
└── Monitoring
    └── Full observability stack
```

### Backend Architecture
```
┌─────────────────────────────────────────┐
│        Cloudflare (DDoS/CDN)            │
└─────────────────────────────────────────┘
                    │
        ┌───────────┴───────────┐
        │                       │
┌───────▼────────┐     ┌───────▼────────┐
│    Vercel      │     │  Railway/Render │
│   (Next.js)    │     │   (API Server)  │
└────────────────┘     └────────────────┘
                               │
                    ┌──────────┴──────────┐
                    │                     │
            ┌───────▼────────┐   ┌───────▼────────┐
            │  Node.js API   │   │  Worker Nodes  │
            │  - Auth        │   │  - Playwright  │
            │  - Rate Limit  │   │  - Scraping    │
            │  - Credits     │   │  - Processing  │
            └────────────────┘   └────────────────┘
                    │                     │
        ┌───────────┴──────────┬─────────┘
        │                      │
┌───────▼──────┐      ┌────────▼────────┐
│  PostgreSQL  │      │     Redis       │
│  (Supabase/  │      │  (Queue/Cache)  │
│    Neon)     │      │                 │
└──────────────┘      └─────────────────┘
```

### Infrastructure Considerations

**CrawlForge MCP Special Requirements:**
- **High Memory**: Browser automation needs 2-4GB RAM per instance
- **CPU Intensive**: Scraping and AI processing require good CPU
- **Bandwidth**: High bandwidth usage for scraping operations
- **Persistent Storage**: For caching and temporary files
- **WebSocket Support**: For real-time job updates
- **Global Proxies**: Integration with proxy services for stealth mode

**Recommended Initial Setup (Railway/Render):**
- **Service**: $20/month (2GB RAM, 1 vCPU)
- **Database**: $20/month (Postgres 2GB)
- **Redis**: $10/month (512MB)
- **Workers**: $40/month (2x workers for scraping)
- **Total**: ~$90/month + bandwidth

### API Design

#### Authentication
```http
POST /api/auth/register
POST /api/auth/login
POST /api/auth/refresh
POST /api/auth/logout
```

#### User Management
```http
GET /api/user/profile
PUT /api/user/profile
GET /api/user/usage
GET /api/user/invoices
```

#### API Keys
```http
GET /api/keys
POST /api/keys
DELETE /api/keys/:id
POST /api/keys/:id/regenerate
```

#### CrawlForge Tools API
```http
POST /api/v1/tools/fetch_url
POST /api/v1/tools/extract_text
POST /api/v1/tools/extract_links
POST /api/v1/tools/extract_metadata
POST /api/v1/tools/scrape_structured
POST /api/v1/tools/search_web
POST /api/v1/tools/crawl_deep
POST /api/v1/tools/map_site
POST /api/v1/tools/extract_content
POST /api/v1/tools/process_document
POST /api/v1/tools/summarize_content
POST /api/v1/tools/analyze_content
POST /api/v1/tools/batch_scrape
POST /api/v1/tools/scrape_with_actions
POST /api/v1/tools/deep_research
POST /api/v1/tools/track_changes
POST /api/v1/tools/generate_llms_txt
POST /api/v1/tools/stealth_mode
POST /api/v1/tools/localization
GET /api/v1/jobs/:id  # For async operations
```

#### Billing
```http
GET /api/billing/plans
POST /api/billing/subscribe
PUT /api/billing/update
DELETE /api/billing/cancel
POST /api/billing/addon
```

### Database Schema

```sql
-- Users
CREATE TABLE users (
  id UUID PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  name VARCHAR(255),
  company VARCHAR(255),
  plan_id VARCHAR(50),
  credits_remaining INTEGER DEFAULT 1000,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- API Keys
CREATE TABLE api_keys (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES users(id),
  key_hash VARCHAR(255) UNIQUE NOT NULL,
  name VARCHAR(255),
  last_used TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  revoked_at TIMESTAMP
);

-- Usage Logs
CREATE TABLE usage_logs (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES users(id),
  api_key_id UUID REFERENCES api_keys(id),
  tool VARCHAR(50),
  credits_used INTEGER,
  request_data JSONB,
  response_status INTEGER,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Subscriptions
CREATE TABLE subscriptions (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES users(id),
  stripe_subscription_id VARCHAR(255),
  plan_id VARCHAR(50),
  status VARCHAR(50),
  current_period_start TIMESTAMP,
  current_period_end TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Jobs (for async operations)
CREATE TABLE jobs (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES users(id),
  type VARCHAR(50),
  status VARCHAR(50),
  progress INTEGER,
  result JSONB,
  webhook_url TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  completed_at TIMESTAMP
);
```

### Security Requirements
- SSL/TLS everywhere
- API key rotation every 90 days (optional)
- Rate limiting per IP and per user
- DDoS protection (Cloudflare)
- Input validation and sanitization
- SQL injection prevention
- XSS protection
- CORS configuration
- Webhook signature verification
- PCI compliance for payments

## Marketing Features

### SEO Optimization
- Schema markup for all pages
- Optimized meta tags
- Sitemap generation
- Blog content strategy
- Landing pages for use cases

### Social Proof Elements
- Customer testimonials carousel
- Case study cards
- Integration partner logos
- GitHub star count badge
- Live usage counter
- Trust badges (SOC2, GDPR)

### Lead Generation
- Free tier signup (no credit card)
- Downloadable guides/ebooks
- Webinar registration
- Newsletter signup
- Exit-intent popups

### Content Marketing
- Technical blog posts
- Video tutorials
- Integration guides
- Comparison pages
- Use case demonstrations

### Developer Marketing
- GitHub presence
- Discord community
- Stack Overflow presence
- Product Hunt launch
- Hacker News strategy
- Conference sponsorships

## Implementation Roadmap

### Phase 1: MVP (Weeks 1-4)
- [ ] Basic landing page
- [ ] User authentication
- [ ] API key generation
- [ ] Simple dashboard
- [ ] Stripe integration
- [ ] Basic API endpoints
- [ ] Documentation site
- [ ] Credit system
- [ ] Basic rate limiting

### Phase 2: Core Features (Weeks 5-8)
- [ ] Interactive playground
- [ ] Advanced usage analytics
- [ ] Enhanced dashboard
- [ ] Email notifications
- [ ] Support ticket system
- [ ] Code examples library

### Phase 3: Growth Features (Weeks 9-12)
- [ ] Webhook system
- [ ] Team accounts
- [ ] Template library
- [ ] Blog platform
- [ ] Affiliate program
- [ ] Advanced integrations

### Phase 4: Enterprise (Weeks 13-16)
- [ ] SSO/SAML
- [ ] Audit logs
- [ ] Custom SLAs
- [ ] White-label options
- [ ] Advanced analytics
- [ ] API versioning

## Success Metrics

### Business KPIs
- Monthly Recurring Revenue (MRR)
- Customer Acquisition Cost (CAC)
- Customer Lifetime Value (CLV)
- Churn rate
- Conversion rate (free to paid)
- Average Revenue Per User (ARPU)

### Product Metrics
- API uptime (target: 99.9%)
- Average response time (<500ms)
- Daily/Monthly Active Users
- Feature adoption rates
- Support ticket volume
- User satisfaction score (NPS)

### Technical Metrics
- Page load time (<2s)
- Time to First Byte (TTFB)
- API error rate (<0.1%)
- Database query performance
- CDN cache hit ratio
- Security incident count
- Infrastructure costs vs revenue ratio (<30%)
- Server response time P95 (<500ms)
- Worker node utilization (60-80%)

## Go-to-Market Strategy

### Launch Plan
1. **Pre-Launch** (Month -1)
   - Beta testing with 100 developers
   - Content creation (10 blog posts)
   - Documentation completion
   - Security audit

2. **Launch Week** (Month 0)
   - Product Hunt launch
   - Hacker News submission
   - Press release
   - Influencer outreach
   - Launch discount (20% off annual)

3. **Post-Launch** (Months 1-3)
   - Weekly feature releases
   - Community building
   - Case study development
   - Partnership development

### Marketing Channels
- **Organic**: SEO, content marketing, GitHub
- **Paid**: Google Ads, Reddit ads, Twitter ads
- **Community**: Discord, Slack communities, forums
- **Partnerships**: Integration partners, resellers
- **Events**: Conferences, webinars, workshops

### Pricing Experiments
- A/B test pricing tiers
- Test free trial vs freemium
- Annual discount optimization
- Add-on pricing validation
- Enterprise negotiation framework

## Risk Mitigation

### Technical Risks
- **Scalability**: Auto-scaling infrastructure
- **Reliability**: Multi-region deployment
- **Security**: Regular audits and testing
- **Performance**: Caching and optimization

### Business Risks
- **Competition**: Unique features and pricing
- **Churn**: Excellent onboarding and support
- **Cash flow**: Annual plans and MRR focus
- **Compliance**: Legal review and policies

### Market Risks
- **Adoption**: Strong free tier and documentation
- **Pricing**: Flexible plans and regular reviews
- **Technology changes**: Modular architecture

## Appendix

### Competitor Analysis
| Feature | CrawlForge MCP | Firecrawl | Apify | ScrapingBee |
|---------|---------------|-----------|-------|-------------|
| MCP Server | ✅ | ✅ | ❌ | ❌ |
| Free Tier | 1,000 credits | 500 credits | Limited | 1,000 calls |
| Starting Price | $19/mo | $16/mo | $49/mo | $49/mo |
| Tools Count | **19** | 5 | Various | 1 |
| Deep Research | ✅ | ❌ | ❌ | ❌ |
| Change Tracking | ✅ | ❌ | ✅ | ❌ |
| Browser Actions | ✅ | ✅ | ✅ | ✅ |
| Stealth Mode | ✅ | ❌ | Partial | ✅ |
| Localization | ✅ (26 countries) | ❌ | ❌ | ❌ |
| LLMs.txt Generator | ✅ | ❌ | ❌ | ❌ |
| PDF Processing | ✅ | ✅ | ✅ | ❌ |
| AI Summarization | ✅ | ❌ | ❌ | ❌ |
| Sentiment Analysis | ✅ | ❌ | ❌ | ❌ |

### Technology Stack Summary
- **Frontend**: Next.js, TypeScript, Tailwind CSS, shadcn/ui, Radix UI
- **Backend**: Node.js, Express/Fastify
- **Database**: Supabase/Neon (PostgreSQL), Redis
- **Queue**: BullMQ with Redis
- **Payments**: Stripe
- **Auth**: Auth0/Clerk
- **Hosting**: 
  - Frontend: Vercel
  - Backend: Railway/Render (MVP), AWS ECS/Cloud Run (Growth)
  - CDN: Cloudflare
- **Monitoring**: Sentry, PostHog (MVP), Datadog (Growth)
- **Analytics**: PostHog, Google Analytics

### Legal Considerations
- Terms of Service
- Privacy Policy
- Data Processing Agreement
- Acceptable Use Policy
- SLA Documentation
- GDPR Compliance
- CCPA Compliance
- Cookie Policy

---

*Document Version: 1.0*  
*Last Updated: 2025-01-15*  
*Status: Ready for Review*