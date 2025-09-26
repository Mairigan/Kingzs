const Joi = require('joi');

const registerValidation = (req, res, next) => {
  const schema = Joi.object({
    email: Joi.string().email().required(),
    password: Joi.string().min(8).required(),
    name: Joi.string().min(2).max(50).required()
  });

  const { error } = schema.validate(req.body);
  if (error) {
    return res.status(400).json({
      success: false,
      error: error.details[0].message
    });
  }

  next();
};

const loginValidation = (req, res, next) => {
  const schema = Joi.object({
    email: Joi.string().email().required(),
    password: Joi.string().required()
  });

  const { error } = schema.validate(req.body);
  if (error) {
    return res.status(400).json({
      success: false,
      error: error.details[0].message
    });
  }

  next();
};

const orderValidation = (req, res, next) => {
  const schema = Joi.object({
    symbol: Joi.string().pattern(/^[A-Z]+\/[A-Z]+$/).required(),
    type: Joi.string().valid('limit', 'market').required(),
    side: Joi.string().valid('buy', 'sell').required(),
    quantity: Joi.number().positive().required(),
    price: Joi.when('type', {
      is: 'limit',
      then: Joi.number().positive().required(),
      otherwise: Joi.number().positive().optional()
    }),
    clientOrderId: Joi.string().optional()
  });

  const { error } = schema.validate(req.body);
  if (error) {
    return res.status(400).json({
      success: false,
      error: error.details[0].message
    });
  }

  next();
};

module.exports = {
  registerValidation,
  loginValidation,
  orderValidation
};