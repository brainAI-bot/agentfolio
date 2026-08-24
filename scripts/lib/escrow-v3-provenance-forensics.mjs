function safeNumber(value, label) {
  const number = Number(value);
  if (!Number.isSafeInteger(number)) throw new Error(`${label} is not a safe integer`);
  return number;
}

function assertRange(bytes, offset, length, label) {
  if (!Number.isInteger(offset) || !Number.isInteger(length)
    || offset < 0 || length < 0 || offset + length > bytes.length) {
    throw new Error(`${label} is outside the ELF`);
  }
}

function readCString(bytes, offset, label) {
  if (!Number.isInteger(offset) || offset < 0 || offset >= bytes.length) {
    throw new Error(`${label} is outside the section-name table`);
  }
  const end = bytes.indexOf(0, offset);
  if (end === -1) throw new Error(`${label} is not null terminated`);
  return bytes.subarray(offset, end).toString('utf8');
}

export function elf64SectionLayout(bytes) {
  if (!Buffer.isBuffer(bytes)) throw new Error('ELF input must be a Buffer');
  assertRange(bytes, 0, 64, 'ELF header');
  if (!bytes.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))) {
    throw new Error('input does not start with an ELF header');
  }
  if (bytes[4] !== 2) throw new Error(`unsupported ELF class ${bytes[4]}`);
  if (bytes[5] !== 1) throw new Error(`unsupported ELF endianness ${bytes[5]}`);

  const sectionHeaderOffset = safeNumber(bytes.readBigUInt64LE(40), 'section-header offset');
  const sectionHeaderSize = bytes.readUInt16LE(58);
  const sectionCount = bytes.readUInt16LE(60);
  const sectionNameIndex = bytes.readUInt16LE(62);
  if (sectionHeaderSize < 64) throw new Error(`invalid section-header size ${sectionHeaderSize}`);
  if (sectionCount === 0) return [];
  if (sectionNameIndex >= sectionCount) {
    throw new Error(`invalid section-name table index ${sectionNameIndex}`);
  }
  assertRange(
    bytes,
    sectionHeaderOffset,
    sectionHeaderSize * sectionCount,
    'section-header table',
  );

  const rawSections = [];
  for (let index = 0; index < sectionCount; index += 1) {
    const offset = sectionHeaderOffset + index * sectionHeaderSize;
    rawSections.push({
      nameOffset: bytes.readUInt32LE(offset),
      type: bytes.readUInt32LE(offset + 4),
      flags: bytes.readBigUInt64LE(offset + 8).toString(),
      address: safeNumber(bytes.readBigUInt64LE(offset + 16), `section ${index} address`),
      offset: safeNumber(bytes.readBigUInt64LE(offset + 24), `section ${index} offset`),
      size: safeNumber(bytes.readBigUInt64LE(offset + 32), `section ${index} size`),
    });
  }

  const names = rawSections[sectionNameIndex];
  assertRange(bytes, names.offset, names.size, 'section-name table');
  const nameBytes = bytes.subarray(names.offset, names.offset + names.size);
  return rawSections.map((section, index) => ({
    index,
    name: readCString(nameBytes, section.nameOffset, `section ${index} name`),
    type: section.type,
    flags: section.flags,
    address: section.address,
    offset: section.offset,
    size: section.size,
  }));
}

export function byteDifferenceCount(left, right) {
  if (!Buffer.isBuffer(left) || !Buffer.isBuffer(right)) {
    throw new Error('byte-difference inputs must be Buffers');
  }
  let differences = Math.abs(left.length - right.length);
  const sharedLength = Math.min(left.length, right.length);
  for (let index = 0; index < sharedLength; index += 1) {
    if (left[index] !== right[index]) differences += 1;
  }
  return differences;
}

export function elfForensics(candidate, deployed) {
  const candidateSections = elf64SectionLayout(candidate);
  const deployedSections = elf64SectionLayout(deployed);
  return {
    byteDifferenceCount: byteDifferenceCount(candidate, deployed),
    sectionLayoutMatches: JSON.stringify(candidateSections) === JSON.stringify(deployedSections),
    candidateSections,
    deployedSections,
  };
}

function instructionVariantName(instructionName) {
  return instructionName
    .split('_')
    .filter(Boolean)
    .map((part) => `${part[0].toUpperCase()}${part.slice(1)}`)
    .join('');
}

export function instructionLabelPresence(idl, deployed) {
  if (!Buffer.isBuffer(deployed)) throw new Error('deployed input must be a Buffer');
  return (idl.instructions || []).map((instruction) => {
    if (typeof instruction.name !== 'string' || instruction.name.length === 0) {
      throw new Error('instruction has an invalid name');
    }
    const label = `${instructionVariantName(instruction.name)}Instruction:`;
    return {
      name: instruction.name,
      compiledLabel: label,
      present: deployed.indexOf(Buffer.from(label)) !== -1,
    };
  });
}
