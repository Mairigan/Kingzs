class LendingEngine {
  constructor() {
    this.loanOffers = new Map();
    this.activeLoans = new Map();
    this.interestRates = new Map();
    this.initializeInterestRates();
  }

  initializeInterestRates() {
    // Default interest rates for different cryptocurrencies
    this.interestRates.set('USDT', { min: 0.02, max: 0.15 }); // 2-15% APY
    this.interestRates.set('BTC', { min: 0.01, max: 0.08 }); // 1-8% APY
    this.interestRates.set('ETH', { min: 0.015, max: 0.1 }); // 1.5-10% APY
    // Add more currencies...
  }

  async createLoanOffer(offerData) {
    const {
      lenderId,
      currency,
      amount,
      interestRate, // APY
      duration, // in days
      minCreditScore = 0,
      collateralRatio = 1.5, // 150% collateral required
      autoRenew = false
    } = offerData;

    const offerId = this.generateOfferId();
    
    const loanOffer = {
      offerId,
      lenderId,
      currency,
      amount: parseFloat(amount),
      interestRate: parseFloat(interestRate),
      duration: parseInt(duration),
      minCreditScore,
      collateralRatio,
      autoRenew,
      status: 'active',
      fundedAmount: 0,
      createdAt: Date.now()
    };

    // Validate interest rate is within acceptable range
    const rateRange = this.interestRates.get(currency);
    if (interestRate < rateRange.min || interestRate > rateRange.max) {
      throw new Error(`Interest rate must be between ${rateRange.min}% and ${rateRange.max}%`);
    }

    this.loanOffers.set(offerId, loanOffer);
    await this.saveLoanOffer(loanOffer);

    return offerId;
  }

  async borrowFunds(loanRequest) {
    const {
      borrowerId,
      currency,
      amount,
      duration,
      collateral
    } = loanRequest;

    // Check borrower's credit score
    const creditScore = await this.getCreditScore(borrowerId);
    if (creditScore < 500) { // Minimum credit score
      throw new Error('Insufficient credit score');
    }

    // Find suitable loan offers
    const suitableOffers = this.findSuitableOffers(currency, amount, duration, creditScore);
    
    if (suitableOffers.length === 0) {
      throw new Error('No suitable loan offers found');
    }

    // Select best offer (lowest interest rate)
    const bestOffer = suitableOffers.sort((a, b) => a.interestRate - b.interestRate)[0];

    // Calculate required collateral
    const requiredCollateral = amount * bestOffer.collateralRatio;
    
    if (collateral.amount < requiredCollateral) {
      throw new Error(`Insufficient collateral. Required: ${requiredCollateral} ${collateral.currency}`);
    }

    // Lock collateral
    await this.lockCollateral(borrowerId, collateral, loanRequest.loanId);

    // Create loan agreement
    const loan = await this.createLoanAgreement(borrowerId, bestOffer, amount, collateral);

    // Transfer funds to borrower
    await this.transferFunds(bestOffer.lenderId, borrowerId, currency, amount);

    return loan;
  }

  async createLoanAgreement(borrowerId, offer, amount, collateral) {
    const loanId = this.generateLoanId();
    
    const loan = {
      loanId,
      borrowerId,
      lenderId: offer.lenderId,
      currency: offer.currency,
      principal: amount,
      interestRate: offer.interestRate,
      duration: offer.duration,
      startDate: Date.now(),
      endDate: Date.now() + (offer.duration * 24 * 60 * 60 * 1000),
      collateral,
      status: 'active',
      payments: [],
      totalPaid: 0,
      remainingBalance: amount * (1 + offer.interestRate / 365 * offer.duration)
    };

    this.activeLoans.set(loanId, loan);
    await this.saveLoan(loan);

    // Schedule loan monitoring
    this.scheduleLoanMonitoring(loanId);

    return loan;
  }

  scheduleLoanMonitoring(loanId) {
    // Check loan health daily
    setInterval(async () => {
      const loan = this.activeLoans.get(loanId);
      if (!loan) return;

      // Check collateral value
      const collateralValue = await this.getCollateralValue(loan.collateral);
      const loanValue = loan.remainingBalance;
      
      // Calculate collateral ratio
      const currentRatio = collateralValue / loanValue;

      if (currentRatio < 1.2) { // Below 120% - margin call
        await this.issueMarginCall(loanId);
      }

      if (currentRatio < 1.1) { // Below 110% - liquidate
        await this.liquidateCollateral(loanId);
      }
    }, 24 * 60 * 60 * 1000); // Daily
  }

  async issueMarginCall(loanId) {
    const loan = this.activeLoans.get(loanId);
    
    // Notify borrower
    await this.notificationService.send({
      userId: loan.borrowerId,
      type: 'margin_call',
      title: 'Margin Call Alert',
      message: `Your loan ${loanId} requires additional collateral`,
      data: { loanId, requiredAction: 'add_collateral' }
    });

    // Give 24 hours to respond
    setTimeout(async () => {
      const updatedLoan = this.activeLoans.get(loanId);
      const currentRatio = await this.getCurrentCollateralRatio(loanId);
      
      if (currentRatio < 1.1) {
        await this.liquidateCollateral(loanId);
      }
    }, 24 * 60 * 60 * 1000);
  }

  async liquidateCollateral(loanId) {
    const loan = this.activeLoans.get(loanId);
    
    // Sell collateral to repay loan
    const liquidationResult = await this.tradingEngine.placeOrder({
      symbol: `${loan.collateral.currency}/USDT`,
      type: 'market',
      side: 'sell',
      quantity: loan.collateral.amount
    });

    // Repay loan with liquidation proceeds
    const repaymentAmount = Math.min(liquidationResult.proceeds, loan.remainingBalance);
    await this.repayLoan(loanId, repaymentAmount);

    // Update loan status
    loan.status = 'liquidated';
    await this.updateLoan(loan);

    console.log(`Loan ${loanId} liquidated`);
  }
}
