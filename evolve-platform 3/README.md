# Evolve Technology Solutions Hub — Extended prototype

Includes public website, Academy/course catalogue, learner portal prototype, admin preview, sector discovery guide and draft pricing page. Logo is in assets/.

## Pages
- index.html: public website; voice navigation, read-aloud, navigation helper/chat prototype
- sector-solutions.html?sector=healthcare: multi-step discovery for eight sectors
- courses.html: Academy catalogue prototype
- portal.html: learner portal prototype
- admin.html: admin UI preview (not secured or connected to backend)
- pricing.html: proposed starting prices, free learning and optional certificate fee

## Important prototype limits
- Voice recognition is browser/device dependent. Language support depends on speech engine and installed voice/language packs; universal-language support cannot be guaranteed.
- Chat is a limited local navigation helper, not a connected AI backend. It is restricted to software navigation/feature questions.
- Registration and enquiry forms are not connected to a server database or email delivery. The quote form drafts email locally. Avoid real personal/confidential data.
- Pricing figures are proposed editable drafts. The source proposal did not specify numeric rates; review before publishing.
- Payments are not connected. Paystack, Flutterwave, Stripe, mobile-money or bank-transfer collection needs verified business merchant/payout accounts, server-side secrets, webhook verification, refunds and compliance configuration. No company account details are embedded.
- Admin preview is not a secure login system. Production needs database, authentication, role-based access, secure storage, backups, monitoring and privacy controls.
- Proposal Section 9 Financial Projections and Funding Requirements is excluded.

## Deployment
Publish the folder on a host supporting static HTML and custom domains. Connect evolvetechhub.com only after registrar ownership and DNS are verified. Full backend services must be implemented before live use of registration, payments or staff admin.
