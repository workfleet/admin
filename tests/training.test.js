import { describe, expect, it } from 'vitest';
import {
  certificationLine,
  isTraining,
  jobHeadline,
  jobSubtitle,
  jobTag,
  trainerLine,
  trainingJobFields,
} from '../lib/training.js';

const clean = {
  kind: 'clean',
  properties: { address: '12 Bute Street', clients: { name: 'Harbour Lets' } },
};

const training = {
  kind: 'training',
  training_title: 'Fire safety refresher',
  training_location: 'Head office',
  training_trainer: 'Dan Powell',
  training_certification_name: 'Fire safety',
  training_certification_expiry: '2029-03-01',
  properties: null,
};

describe('isTraining', () => {
  it('tells the two kinds apart, and copes with a job that has neither', () => {
    expect(isTraining(training)).toBe(true);
    expect(isTraining(clean)).toBe(false);
    // A job read by a select that has not been given the kind column yet
    // must not be mistaken for training.
    expect(isTraining({})).toBe(false);
    expect(isTraining(null)).toBe(false);
  });
});

describe('jobHeadline', () => {
  it('leads a clean with its address and a training with what it is', () => {
    expect(jobHeadline(clean)).toBe('12 Bute Street');
    expect(jobHeadline(training)).toBe('Fire safety refresher');
  });

  it('never gives a block nothing to say', () => {
    // The null property is the whole point: before 0115 this read
    // job.properties.address and would have thrown here.
    expect(jobHeadline({ kind: 'training', properties: null })).toBe('Training');
    expect(jobHeadline({ kind: 'training', training_title: '   ' })).toBe('Training');
    expect(jobHeadline({ kind: 'clean', properties: null })).toBe('No address');
  });
});

describe('jobSubtitle', () => {
  it('names the client for a clean and the venue for a training', () => {
    expect(jobSubtitle(clean)).toBe('Harbour Lets');
    expect(jobSubtitle(training)).toBe('Head office');
  });

  it('is blank rather than borrowed when there is no venue', () => {
    expect(jobSubtitle({ kind: 'training', training_title: 'COSHH' })).toBe('');
    expect(jobSubtitle({ kind: 'clean', properties: null })).toBe('');
  });
});

describe('jobTag', () => {
  it('tags training only', () => {
    expect(jobTag(training)).toBe('Training');
    expect(jobTag(clean)).toBeNull();
  });
});

describe('trainerLine', () => {
  it('names the trainer when there is one', () => {
    expect(trainerLine(training)).toBe('Run by Dan Powell');
  });

  it('gives nothing to print when nobody was named', () => {
    expect(trainerLine({ kind: 'training', training_trainer: '  ' })).toBeNull();
    expect(trainerLine(clean)).toBeNull();
  });
});

describe('certificationLine', () => {
  it('says what will be written to the attendees records', () => {
    expect(certificationLine(training)).toBe(
      `Recorded as "Fire safety" for everyone who attends, expiring ${new Date('2029-03-01T00:00:00').toLocaleDateString()}`
    );
  });

  it('drops the expiry when the certificate does not have one', () => {
    expect(certificationLine({ ...training, training_certification_expiry: null }))
      .toBe('Recorded as "Fire safety" for everyone who attends');
    expect(certificationLine({ ...training, training_certification_expiry: 'whenever' }))
      .toBe('Recorded as "Fire safety" for everyone who attends');
  });

  it('is silent when the session earns no certificate', () => {
    expect(certificationLine({ ...training, training_certification_name: '  ' })).toBeNull();
    expect(certificationLine(clean)).toBeNull();
  });
});

describe('trainingJobFields', () => {
  it('builds a row 0115 will accept', () => {
    expect(trainingJobFields({
      title: '  Fire safety refresher ',
      location: ' Head office ',
      trainer: 'Dan Powell',
      certificationName: 'Fire safety',
      certificationExpiry: '2029-03-01',
    })).toEqual({
      kind: 'training',
      property_id: null,
      training_title: 'Fire safety refresher',
      training_location: 'Head office',
      training_trainer: 'Dan Powell',
      training_certification_name: 'Fire safety',
      training_certification_expiry: '2029-03-01',
    });
  });

  it('blanks empty text rather than storing whitespace', () => {
    expect(trainingJobFields({ title: 'COSHH', location: '   ', trainer: '' }))
      .toEqual({
        kind: 'training',
        property_id: null,
        training_title: 'COSHH',
        training_location: null,
        training_trainer: null,
        training_certification_name: null,
        training_certification_expiry: null,
      });
  });

  it('drops an expiry that has no certificate to expire', () => {
    const fields = trainingJobFields({ title: 'Toolbox talk', certificationExpiry: '2029-03-01' });
    expect(fields.training_certification_name).toBeNull();
    expect(fields.training_certification_expiry).toBeNull();
  });
});
