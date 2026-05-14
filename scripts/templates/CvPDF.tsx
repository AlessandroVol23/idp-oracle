import React from 'react';
import { Document, Page, View, Text } from '@react-pdf/renderer';
import { styles } from './styles.js';
import type { CvFields } from '@idp/schemas';

export function CvPDF({ data }: { data: CvFields }) {
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Text style={styles.h1}>{data.name}</Text>
        <Text style={styles.subtle}>
          {[data.email, data.phone, data.location].filter(Boolean).join(' · ')}
        </Text>

        <Text style={styles.h2}>Profile</Text>
        <Text>
          {data.yearsExperience} years of professional experience.
        </Text>

        <Text style={styles.h2}>Skills</Text>
        <Text>{data.skills.join(', ')}</Text>

        <Text style={styles.h2}>Experience</Text>
        {data.workHistory.map((w, i) => (
          <View key={i} style={{ marginBottom: 8 }}>
            <Text style={styles.bold}>
              {w.title} — {w.company}
            </Text>
            <Text style={styles.subtle}>
              {w.start} – {w.end ?? 'present'}
            </Text>
            <Text style={{ marginTop: 2 }}>{w.summary}</Text>
          </View>
        ))}

        <Text style={styles.h2}>Education</Text>
        {data.education.map((e, i) => (
          <View key={i} style={styles.row}>
            <Text style={styles.label}>{e.year}</Text>
            <Text style={styles.value}>
              {e.degree}, {e.institution}
            </Text>
          </View>
        ))}
      </Page>
    </Document>
  );
}
