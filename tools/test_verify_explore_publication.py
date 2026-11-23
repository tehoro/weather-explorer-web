import unittest
from verify_explore_publication import verify_publication


class PublicationTests(unittest.TestCase):
    def test_stale_pointer_recovers(self):
        waits = []
        pointers = iter(['2026112300', '2026112306'])
        def fetch(path):
            if path == 'latest.json':
                run = next(pointers)
                return {'run': run, 'manifest': run + '/manifest.json'}
            return {'run': '2026112306', 'steps': list(range(3, 85, 3))}
        self.assertEqual(verify_publication('2026112306', fetch, waits.append), '2026112306')
        self.assertEqual(waits, [10])

    def test_persistent_staleness_fails(self):
        with self.assertRaisesRegex(ValueError, 'expected'):
            verify_publication('2026112306', lambda _: {
                'run': '2026112300', 'manifest': '2026112300/manifest.json'},
                lambda _: None, attempts=2)

    def test_incomplete_manifest_fails(self):
        def fetch(path):
            if path == 'latest.json':
                return {'run': '2026112306', 'manifest': '2026112306/manifest.json'}
            return {'run': '2026112306', 'steps': [3, 6]}
        with self.assertRaisesRegex(ValueError, 'incomplete'):
            verify_publication('2026112306', fetch, attempts=1)


if __name__ == '__main__':
    unittest.main()
